"""
Live logs streaming service using Redis pub/sub.

Enables real-time streaming of network requests and console logs
from Celery workers to WebSocket clients.
"""

import json
import logging
from datetime import datetime
from typing import Any

import redis.asyncio as aioredis

from app.config import settings

logger = logging.getLogger(__name__)

# Channel naming convention
def get_run_channel(run_id: str, log_type: str) -> str:
    """Get Redis channel name for a run's logs."""
    return f"run:{run_id}:{log_type}"


class LiveLogsPublisher:
    """Publishes live logs to Redis from Celery workers."""
    
    def __init__(self, run_id: str):
        self.run_id = run_id
        self._redis = None
    
    def _get_redis(self):
        """Get sync Redis client (for use in Celery workers)."""
        if self._redis is None:
            import redis
            self._redis = redis.from_url(settings.CELERY_BROKER_URL)
        return self._redis
    
    def publish_network_request(self, data: dict) -> None:
        """Publish a network request event."""
        try:
            channel = get_run_channel(self.run_id, "network")
            # Ensure datetime objects are serialized
            serialized = self._serialize(data)
            self._get_redis().publish(channel, json.dumps(serialized))
        except Exception as e:
            logger.debug(f"Failed to publish network request: {e}")
    
    def publish_console_log(self, data: dict) -> None:
        """Publish a console log event."""
        try:
            channel = get_run_channel(self.run_id, "console")
            serialized = self._serialize(data)
            self._get_redis().publish(channel, json.dumps(serialized))
        except Exception as e:
            logger.debug(f"Failed to publish console log: {e}")
    
    def publish_step_update(self, step_index: int, status: str, action: str, error: str | None = None) -> None:
        """Publish a step status update."""
        try:
            channel = get_run_channel(self.run_id, "steps")
            data = {
                "step_index": step_index,
                "status": status,
                "action": action,
                "error": error,
                "timestamp": datetime.utcnow().isoformat(),
            }
            self._get_redis().publish(channel, json.dumps(data))
        except Exception as e:
            logger.debug(f"Failed to publish step update: {e}")
    
    def _serialize(self, data: dict) -> dict:
        """Serialize data for JSON encoding."""
        result = {}
        for key, value in data.items():
            if isinstance(value, datetime):
                result[key] = value.isoformat()
            elif isinstance(value, dict):
                result[key] = self._serialize(value)
            else:
                result[key] = value
        return result
    
    def close(self):
        """Close Redis connection."""
        if self._redis:
            self._redis.close()
            self._redis = None


class LiveLogsSubscriber:
    """Subscribes to live logs from Redis for WebSocket streaming."""
    
    def __init__(self, run_id: str):
        self.run_id = run_id
        self._redis: aioredis.Redis | None = None
        self._pubsub = None
    
    async def connect(self):
        """Connect to Redis."""
        self._redis = aioredis.from_url(settings.CELERY_BROKER_URL)
        self._pubsub = self._redis.pubsub()
        
        # Subscribe to all log channels for this run
        await self._pubsub.subscribe(
            get_run_channel(self.run_id, "network"),
            get_run_channel(self.run_id, "console"),
            get_run_channel(self.run_id, "steps"),
        )
        logger.info(f"Subscribed to live logs for run {self.run_id}")
    
    async def get_message(self, timeout: float = 1.0) -> dict | None:
        """Get next message from subscribed channels.
        
        Returns:
            Dict with 'type' (network/console/steps) and 'data', or None if timeout.
        """
        try:
            message = await self._pubsub.get_message(
                ignore_subscribe_messages=True,
                timeout=timeout
            )
            
            if message and message.get("type") == "message":
                channel = message["channel"]
                if isinstance(channel, bytes):
                    channel = channel.decode()
                
                # Extract log type from channel name
                # Format: run:{run_id}:{log_type}
                parts = channel.split(":")
                log_type = parts[-1] if len(parts) >= 3 else "unknown"
                
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                
                return {
                    "type": f"live_{log_type}",
                    "data": json.loads(data),
                }
        except Exception as e:
            logger.debug(f"Error getting message: {e}")
        
        return None
    
    async def close(self):
        """Close Redis connection."""
        if self._pubsub:
            await self._pubsub.unsubscribe()
            await self._pubsub.close()
        if self._redis:
            await self._redis.close()
