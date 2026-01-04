"""
Container Pool Manager - Manages pools of pre-warmed browser containers for scaling.

Supports two isolation modes:
- Context: Reuse containers from pool with fresh browser context per run (fast ~1s)
- Ephemeral: New container per run, destroyed after completion (isolated ~10-15s)

Features:
- Pre-warm containers for each browser type
- Container health checks and recycling
- Max uses per container before recycling
- TTL-based container expiration
"""

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any
from uuid import uuid4

import aiohttp
import docker
from docker.errors import NotFound, APIError

logger = logging.getLogger(__name__)


class BrowserType(str, Enum):
    """Supported browser types."""
    CHROMIUM = "chromium"
    FIREFOX = "firefox"
    WEBKIT = "webkit"
    EDGE = "edge"


class IsolationMode(str, Enum):
    """Container isolation modes."""
    CONTEXT = "context"      # Reuse container, fresh browser context
    EPHEMERAL = "ephemeral"  # New container per run


class ContainerStatus(str, Enum):
    """Status of a pooled container."""
    STARTING = "starting"
    READY = "ready"
    IN_USE = "in_use"
    RECYCLING = "recycling"
    ERROR = "error"


# Browser-specific Docker images (local builds)
BROWSER_IMAGES = {
    BrowserType.CHROMIUM: "qa-test-browser:chromium",
    BrowserType.FIREFOX: "qa-test-browser:firefox",
    BrowserType.WEBKIT: "qa-test-browser:webkit",
    BrowserType.EDGE: "qa-test-browser:edge",
}

# Default image (Chromium)
DEFAULT_IMAGE = "qa-test-browser:chromium"


@dataclass
class PooledContainer:
    """A container in the pool."""
    id: str
    container_id: str
    container_name: str
    browser_type: BrowserType
    status: ContainerStatus
    cdp_port: int  # Host port for HTTP API (mapped from 9222)
    ws_port: int | None = None  # Host port for WebSocket (mapped from 9223)
    cdp_ws_url: str | None = None
    container_ip: str | None = None
    created_at: datetime = field(default_factory=datetime.utcnow)
    last_used_at: datetime = field(default_factory=datetime.utcnow)
    use_count: int = 0
    current_run_id: str | None = None
    error_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "container_id": self.container_id,
            "container_name": self.container_name,
            "browser_type": self.browser_type.value,
            "status": self.status.value,
            "cdp_port": self.cdp_port,
            "ws_port": self.ws_port,
            "cdp_ws_url": self.cdp_ws_url,
            "container_ip": self.container_ip,
            "created_at": self.created_at.isoformat(),
            "last_used_at": self.last_used_at.isoformat(),
            "use_count": self.use_count,
            "current_run_id": self.current_run_id,
            "error_message": self.error_message,
        }


class ContainerPool:
    """
    Manages pools of pre-warmed browser containers.

    Configuration:
    - pool_size_per_browser: Number of containers to keep warm per browser type
    - max_container_uses: Max uses before recycling a container
    - container_ttl_minutes: Max lifetime of a container
    """

    CONTAINER_WS_PORT = 9222  # Playwright WebSocket server port

    def __init__(
        self,
        pool_size_per_browser: int = 2,
        max_container_uses: int = 50,
        container_ttl_minutes: int = 30,
        network_name: str = "qa-browser-network",
    ):
        self.pool_size_per_browser = pool_size_per_browser
        self.max_container_uses = max_container_uses
        self.container_ttl = timedelta(minutes=container_ttl_minutes)
        self.network_name = network_name

        # Pools per browser type
        self._pools: dict[BrowserType, list[PooledContainer]] = {
            bt: [] for bt in BrowserType
        }

        # Containers currently in use (for all modes)
        self._in_use: dict[str, PooledContainer] = {}

        # Lock for thread-safe pool operations
        self._lock = asyncio.Lock()

        self._docker_client: docker.DockerClient | None = None
        self._maintenance_task: asyncio.Task | None = None
        self._running_in_docker = self._detect_docker_environment()
        self._initialized = False

    def _detect_docker_environment(self) -> bool:
        """Detect if we're running inside a Docker container."""
        import os
        if os.path.exists("/.dockerenv"):
            return True
        try:
            with open("/proc/1/cgroup", "r") as f:
                return "docker" in f.read()
        except Exception:
            return False

    @property
    def docker_client(self) -> docker.DockerClient:
        """Get or create Docker client."""
        if self._docker_client is None:
            self._docker_client = docker.from_env()
        return self._docker_client

    def _ensure_network(self) -> None:
        """Ensure the Docker network exists."""
        try:
            self.docker_client.networks.get(self.network_name)
        except NotFound:
            logger.info(f"Creating Docker network '{self.network_name}'")
            self.docker_client.networks.create(
                self.network_name,
                driver="bridge",
                labels={"app": "qa-base"},
            )

    async def initialize(self, browser_types: list[BrowserType] | None = None) -> None:
        """
        Initialize the pool by pre-warming containers.

        Args:
            browser_types: Browser types to pre-warm (default: chromium only)
        """
        if self._initialized:
            return

        self._ensure_network()

        if browser_types is None:
            browser_types = [BrowserType.CHROMIUM]

        logger.info(f"Initializing container pool for browsers: {[bt.value for bt in browser_types]}")

        # Pre-warm containers for each browser type
        for browser_type in browser_types:
            await self._fill_pool(browser_type)

        # Start maintenance task
        await self._start_maintenance_task()

        self._initialized = True
        logger.info("Container pool initialized")

    async def _fill_pool(self, browser_type: BrowserType) -> None:
        """Fill the pool for a browser type to the target size."""
        async with self._lock:
            pool = self._pools[browser_type]
            ready_count = sum(1 for c in pool if c.status == ContainerStatus.READY)
            needed = self.pool_size_per_browser - ready_count

            if needed <= 0:
                return

            logger.info(f"Pre-warming {needed} {browser_type.value} containers")

            # Create containers in parallel
            tasks = [self._create_container(browser_type) for _ in range(needed)]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for result in results:
                if isinstance(result, PooledContainer):
                    pool.append(result)
                elif isinstance(result, Exception):
                    logger.error(f"Failed to create {browser_type.value} container: {result}")

    async def _create_container(
        self,
        browser_type: BrowserType,
        resolution: tuple[int, int] = (1920, 1080),
    ) -> PooledContainer:
        """Create a new container for the pool."""
        container_id_short = str(uuid4())[:8]
        container_name = f"qa-pool-{browser_type.value}-{container_id_short}"

        # Get browser-specific image or default
        image = BROWSER_IMAGES.get(browser_type, DEFAULT_IMAGE)

        logger.debug(f"Creating pooled container: {container_name} with image {image}")

        loop = asyncio.get_event_loop()

        try:
            container = await loop.run_in_executor(
                None,
                lambda: self.docker_client.containers.run(
                    image=image,
                    detach=True,
                    name=container_name,
                    environment={
                        "SCREEN_WIDTH": str(resolution[0]),
                        "SCREEN_HEIGHT": str(resolution[1]),
                        "SCREEN_DEPTH": "24",
                    },
                    ports={
                        f"{self.CONTAINER_WS_PORT}/tcp": ("0.0.0.0", 0),
                    },
                    labels={
                        "app": "qa-base",
                        "pool_container": "true",
                        "browser_type": browser_type.value,
                    },
                    network=self.network_name,
                    shm_size="2g",
                    mem_limit="2g",
                    cpu_period=100000,
                    cpu_quota=100000,
                )
            )

            # Wait for container to start and get port mappings
            # Retry a few times as Docker may take time to assign ports
            ws_port = None
            for attempt in range(10):
                await asyncio.sleep(1)
                await loop.run_in_executor(None, container.reload)

                network_settings = container.attrs.get("NetworkSettings", {})
                ports = network_settings.get("Ports", {})

                ws_mapping = ports.get(f"{self.CONTAINER_WS_PORT}/tcp")

                if ws_mapping and len(ws_mapping) > 0:
                    ws_port = int(ws_mapping[0]["HostPort"])
                    break

                logger.debug(f"Attempt {attempt + 1}: Waiting for port mappings... Ports: {ports}")

            if not ws_port:
                container_status = container.status
                container_logs = container.logs(tail=20).decode('utf-8', errors='ignore')
                logger.error(f"Container status: {container_status}, Logs: {container_logs}")
                raise RuntimeError(f"Ports not mapped after 10 attempts. Container status: {container_status}")

            # Get container IP
            container_ip = None
            networks = network_settings.get("Networks", {})
            if self.network_name in networks:
                container_ip = networks[self.network_name].get("IPAddress")

            pooled = PooledContainer(
                id=container_id_short,
                container_id=container.id,
                container_name=container_name,
                browser_type=browser_type,
                status=ContainerStatus.STARTING,
                cdp_port=ws_port,  # Playwright uses single port for both HTTP and WS
                ws_port=ws_port,
                container_ip=container_ip,
            )

            # Wait for Playwright server to be ready
            await self._wait_for_playwright_ready(pooled)

            pooled.status = ContainerStatus.READY
            logger.info(f"Pooled container ready: {container_name}, WS port: {ws_port}")

            return pooled

        except Exception as e:
            logger.error(f"Failed to create pooled container: {e}")
            # Cleanup on failure
            try:
                container = self.docker_client.containers.get(container_name)
                container.remove(force=True)
            except Exception:
                pass
            raise

    async def _wait_for_playwright_ready(
        self,
        container: PooledContainer,
        timeout: int = 60,
    ) -> None:
        """Wait for Playwright browser server to be ready and get WebSocket URL."""
        start_time = datetime.utcnow()

        if self._running_in_docker and container.container_ip:
            check_host = container.container_ip
            check_port = self.CONTAINER_WS_PORT
        else:
            check_host = "127.0.0.1"
            check_port = container.ws_port

        base_url = f"http://{check_host}:{check_port}"

        while (datetime.utcnow() - start_time).seconds < timeout:
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{base_url}/json",
                        timeout=aiohttp.ClientTimeout(total=5)
                    ) as resp:
                        if resp.status == 200:
                            info = await resp.json()
                            ws_endpoint_path = info.get("wsEndpointPath")
                            if ws_endpoint_path:
                                if self._running_in_docker and container.container_ip:
                                    container.cdp_ws_url = f"ws://{container.container_ip}:{self.CONTAINER_WS_PORT}{ws_endpoint_path}"
                                else:
                                    container.cdp_ws_url = f"ws://127.0.0.1:{container.ws_port}{ws_endpoint_path}"
                                logger.info(f"Playwright server ready: {container.cdp_ws_url}")
                                return

            except Exception as e:
                logger.debug(f"Playwright not ready: {e}")

            await asyncio.sleep(1)

        raise TimeoutError(f"Playwright server did not become ready within {timeout} seconds")

    async def acquire(
        self,
        browser_type: BrowserType,
        isolation_mode: IsolationMode = IsolationMode.CONTEXT,
        run_id: str | None = None,
        resolution: tuple[int, int] = (1920, 1080),
    ) -> PooledContainer:
        """
        Acquire a container for a test run.

        Args:
            browser_type: Type of browser needed
            isolation_mode: Context (from pool) or Ephemeral (new container)
            run_id: ID of the test run using this container
            resolution: Browser viewport resolution

        Returns:
            PooledContainer ready for use
        """
        if isolation_mode == IsolationMode.EPHEMERAL:
            # Ephemeral mode: always create a new container
            logger.info(f"Creating ephemeral container for run {run_id}")
            container = await self._create_container(browser_type, resolution)
            container.current_run_id = run_id
            container.status = ContainerStatus.IN_USE

            async with self._lock:
                self._in_use[container.id] = container

            return container

        # Context mode: try to get from pool
        async with self._lock:
            pool = self._pools[browser_type]

            # Find a ready container
            for container in pool:
                if container.status == ContainerStatus.READY:
                    container.status = ContainerStatus.IN_USE
                    container.current_run_id = run_id
                    container.last_used_at = datetime.utcnow()
                    container.use_count += 1

                    self._in_use[container.id] = container
                    pool.remove(container)

                    logger.info(f"Acquired pooled container {container.container_name} for run {run_id}")
                    return container

        # No container available in pool, create one
        logger.info(f"Pool empty for {browser_type.value}, creating new container")
        container = await self._create_container(browser_type, resolution)
        container.current_run_id = run_id
        container.status = ContainerStatus.IN_USE
        container.use_count = 1

        async with self._lock:
            self._in_use[container.id] = container

        return container

    async def release(
        self,
        container_id: str,
        isolation_mode: IsolationMode = IsolationMode.CONTEXT,
    ) -> None:
        """
        Release a container after use.

        Args:
            container_id: ID of the container to release
            isolation_mode: How the container was used
        """
        async with self._lock:
            container = self._in_use.pop(container_id, None)

        if not container:
            logger.warning(f"Container {container_id} not found in use list")
            return

        container.current_run_id = None
        container.last_used_at = datetime.utcnow()

        if isolation_mode == IsolationMode.EPHEMERAL:
            # Ephemeral: destroy immediately
            logger.info(f"Destroying ephemeral container {container.container_name}")
            await self._destroy_container(container)
            return

        # Context mode: return to pool or recycle
        should_recycle = (
            container.use_count >= self.max_container_uses or
            datetime.utcnow() - container.created_at > self.container_ttl or
            container.status == ContainerStatus.ERROR
        )

        if should_recycle:
            logger.info(f"Recycling container {container.container_name} (uses: {container.use_count})")
            await self._destroy_container(container)
            # Trigger pool refill
            asyncio.create_task(self._fill_pool(container.browser_type))
        else:
            # Return to pool
            container.status = ContainerStatus.READY
            async with self._lock:
                self._pools[container.browser_type].append(container)
            logger.debug(f"Returned container {container.container_name} to pool")

    async def _destroy_container(self, container: PooledContainer) -> None:
        """Destroy a container."""
        try:
            loop = asyncio.get_event_loop()
            docker_container = await loop.run_in_executor(
                None,
                lambda: self.docker_client.containers.get(container.container_id)
            )
            await loop.run_in_executor(None, lambda: docker_container.stop(timeout=5))
            await loop.run_in_executor(None, lambda: docker_container.remove(force=True))
            logger.debug(f"Destroyed container {container.container_name}")
        except NotFound:
            logger.debug(f"Container {container.container_name} already removed")
        except Exception as e:
            logger.error(f"Error destroying container {container.container_name}: {e}")

    async def health_check(self) -> dict[str, Any]:
        """Check health of all pooled containers."""
        results = {
            "pools": {},
            "in_use": len(self._in_use),
            "total_containers": 0,
            "healthy": 0,
            "unhealthy": 0,
        }

        for browser_type, pool in self._pools.items():
            pool_health = {
                "size": len(pool),
                "ready": 0,
                "starting": 0,
                "error": 0,
            }

            for container in pool:
                results["total_containers"] += 1
                if container.status == ContainerStatus.READY:
                    # Verify CDP is still responding
                    if await self._ping_cdp(container):
                        pool_health["ready"] += 1
                        results["healthy"] += 1
                    else:
                        container.status = ContainerStatus.ERROR
                        pool_health["error"] += 1
                        results["unhealthy"] += 1
                elif container.status == ContainerStatus.STARTING:
                    pool_health["starting"] += 1
                elif container.status == ContainerStatus.ERROR:
                    pool_health["error"] += 1
                    results["unhealthy"] += 1

            results["pools"][browser_type.value] = pool_health

        return results

    async def _ping_cdp(self, container: PooledContainer) -> bool:
        """Ping CDP endpoint to check if container is healthy."""
        try:
            if self._running_in_docker and container.container_ip:
                url = f"http://{container.container_ip}:{self.CONTAINER_CDP_PORT}/json/version"
            else:
                url = f"http://127.0.0.1:{container.cdp_port}/json/version"

            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as resp:
                    return resp.status == 200
        except Exception:
            return False

    async def _start_maintenance_task(self, interval_seconds: int = 30) -> None:
        """Start background maintenance task."""
        async def maintenance_loop():
            while True:
                try:
                    await asyncio.sleep(interval_seconds)
                    await self._run_maintenance()
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error(f"Error in maintenance task: {e}")

        self._maintenance_task = asyncio.create_task(maintenance_loop())
        logger.info("Container pool maintenance task started")

    async def _run_maintenance(self) -> None:
        """Run maintenance: health checks, cleanup expired, refill pools."""
        # Health check
        health = await self.health_check()
        logger.debug(f"Pool health: {health}")

        # Remove unhealthy containers
        for browser_type, pool in self._pools.items():
            async with self._lock:
                unhealthy = [c for c in pool if c.status == ContainerStatus.ERROR]
                for container in unhealthy:
                    pool.remove(container)
                    asyncio.create_task(self._destroy_container(container))

            # Refill pool if needed
            await self._fill_pool(browser_type)

    async def shutdown(self) -> None:
        """Shutdown the pool and destroy all containers."""
        logger.info("Shutting down container pool...")

        # Stop maintenance task
        if self._maintenance_task:
            self._maintenance_task.cancel()
            try:
                await self._maintenance_task
            except asyncio.CancelledError:
                pass

        # Destroy all containers
        all_containers = []
        for pool in self._pools.values():
            all_containers.extend(pool)
        all_containers.extend(self._in_use.values())

        for container in all_containers:
            await self._destroy_container(container)

        self._pools = {bt: [] for bt in BrowserType}
        self._in_use = {}
        self._initialized = False

        logger.info("Container pool shutdown complete")

    def get_stats(self) -> dict[str, Any]:
        """Get pool statistics."""
        stats = {
            "initialized": self._initialized,
            "pools": {},
            "in_use_count": len(self._in_use),
            "in_use": [c.to_dict() for c in self._in_use.values()],
        }

        for browser_type, pool in self._pools.items():
            stats["pools"][browser_type.value] = {
                "size": len(pool),
                "containers": [c.to_dict() for c in pool],
            }

        return stats


# Global pool instance
_pool: ContainerPool | None = None


def get_container_pool() -> ContainerPool:
    """Get the global container pool instance."""
    global _pool
    if _pool is None:
        _pool = ContainerPool()
    return _pool


async def init_container_pool(browser_types: list[BrowserType] | None = None) -> ContainerPool:
    """Initialize the global container pool."""
    pool = get_container_pool()
    await pool.initialize(browser_types)
    return pool


async def shutdown_container_pool() -> None:
    """Shutdown the global container pool."""
    global _pool
    if _pool:
        await _pool.shutdown()
        _pool = None
