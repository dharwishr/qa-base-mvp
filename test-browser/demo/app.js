// CDP Connection Manager
class CDPClient {
    constructor() {
        this.ws = null;
        this.messageId = 0;
        this.pendingMessages = new Map();
        this.connected = false;
        this.targetId = null;
    }

    async connect(cdpUrl) {
        // Use CORS proxy (port 9224) for the HTTP request, but keep original for WebSocket
        const corsProxyUrl = cdpUrl.replace(':9222', ':9224');

        // First, get the list of available targets via CORS proxy
        const response = await fetch(`${corsProxyUrl}/json`);
        const targets = await response.json();

        // Find a page target
        const pageTarget = targets.find(t => t.type === 'page');
        if (!pageTarget) {
            throw new Error('No page target found');
        }

        this.targetId = pageTarget.id;

        // Connect to the WebSocket
        return new Promise((resolve, reject) => {
            const wsUrl = pageTarget.webSocketDebuggerUrl;
            console.log('Connecting to WebSocket:', wsUrl);

            // Set a connection timeout
            const timeout = setTimeout(() => {
                if (this.ws) {
                    this.ws.close();
                }
                reject(new Error(`WebSocket connection timeout (10s) to ${wsUrl}`));
            }, 10000);

            try {
                this.ws = new WebSocket(wsUrl);
            } catch (e) {
                clearTimeout(timeout);
                reject(new Error(`Failed to create WebSocket: ${e.message}`));
                return;
            }

            this.ws.onopen = () => {
                clearTimeout(timeout);
                this.connected = true;
                console.log('WebSocket connected');
                resolve();
            };

            this.ws.onerror = (error) => {
                clearTimeout(timeout);
                console.error('WebSocket error:', error);
                reject(new Error('WebSocket connection failed - check browser console for details'));
            };

            this.ws.onclose = (event) => {
                clearTimeout(timeout);
                this.connected = false;
                this.pendingMessages.clear();
                console.log('WebSocket closed:', event.code, event.reason);
            };

            this.ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id && this.pendingMessages.has(message.id)) {
                    const { resolve, reject } = this.pendingMessages.get(message.id);
                    this.pendingMessages.delete(message.id);

                    if (message.error) {
                        reject(new Error(message.error.message));
                    } else {
                        resolve(message.result);
                    }
                }
            };
        });
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject(new Error('Not connected to CDP'));
                return;
            }

            const id = ++this.messageId;
            this.pendingMessages.set(id, { resolve, reject });

            this.ws.send(JSON.stringify({ id, method, params }));

            // Timeout after 30 seconds
            setTimeout(() => {
                if (this.pendingMessages.has(id)) {
                    this.pendingMessages.delete(id);
                    reject(new Error('Request timed out'));
                }
            }, 30000);
        });
    }

    // Navigate to a URL
    async navigate(url) {
        await this.send('Page.enable');
        return await this.send('Page.navigate', { url });
    }

    // Click on an element by selector
    async click(selector) {
        // First, find the element and get its coordinates
        const result = await this.send('Runtime.evaluate', {
            expression: `
                (function() {
                    const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                    if (!el) return null;
                    const rect = el.getBoundingClientRect();
                    return {
                        x: rect.x + rect.width / 2,
                        y: rect.y + rect.height / 2
                    };
                })()
            `,
            returnByValue: true
        });

        if (!result.result.value) {
            throw new Error(`Element not found: ${selector}`);
        }

        const { x, y } = result.result.value;

        // Dispatch mouse events
        await this.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            clickCount: 1
        });

        await this.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1
        });
    }

    // Type text into an element
    async type(selector, text) {
        // First click to focus the element
        await this.click(selector);

        // Small delay after click
        await new Promise(resolve => setTimeout(resolve, 100));

        // Type each character
        for (const char of text) {
            await this.send('Input.dispatchKeyEvent', {
                type: 'keyDown',
                text: char
            });
            await this.send('Input.dispatchKeyEvent', {
                type: 'keyUp',
                text: char
            });
        }
    }

    // Take a screenshot
    async screenshot() {
        await this.send('Page.enable');
        const result = await this.send('Page.captureScreenshot', {
            format: 'png'
        });
        return result.data; // base64 encoded
    }
}

// UI Controller
class UIController {
    constructor() {
        this.cdp = new CDPClient();
        this.initElements();
        this.initEventListeners();
    }

    initElements() {
        // Status
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');

        // Connection
        this.cdpUrlInput = document.getElementById('cdpUrl');
        this.connectBtn = document.getElementById('connectBtn');

        // Navigation
        this.urlInput = document.getElementById('urlInput');
        this.navigateBtn = document.getElementById('navigateBtn');

        // Click
        this.clickSelector = document.getElementById('clickSelector');
        this.clickBtn = document.getElementById('clickBtn');

        // Type
        this.typeSelector = document.getElementById('typeSelector');
        this.typeText = document.getElementById('typeText');
        this.typeBtn = document.getElementById('typeBtn');

        // Screenshot
        this.screenshotBtn = document.getElementById('screenshotBtn');
        this.screenshotPreview = document.getElementById('screenshotPreview');

        // VNC
        this.vncFrame = document.getElementById('vncFrame');
        this.refreshVnc = document.getElementById('refreshVnc');

        // Log
        this.actionLog = document.getElementById('actionLog');
        this.clearLog = document.getElementById('clearLog');
    }

    initEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        this.navigateBtn.addEventListener('click', () => this.handleNavigate());
        this.clickBtn.addEventListener('click', () => this.handleClick());
        this.typeBtn.addEventListener('click', () => this.handleType());
        this.screenshotBtn.addEventListener('click', () => this.handleScreenshot());
        this.refreshVnc.addEventListener('click', () => this.handleRefreshVnc());
        this.clearLog.addEventListener('click', () => this.handleClearLog());

        // Enter key handlers
        this.urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleNavigate();
        });
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;
        this.actionLog.appendChild(entry);
        this.actionLog.scrollTop = this.actionLog.scrollHeight;
    }

    setConnected(connected) {
        this.statusDot.classList.toggle('connected', connected);
        this.statusText.textContent = connected ? 'Connected' : 'Disconnected';
        this.connectBtn.textContent = connected ? 'Disconnect' : 'Connect to CDP';

        // Enable/disable action buttons
        const buttons = [this.navigateBtn, this.clickBtn, this.typeBtn, this.screenshotBtn];
        buttons.forEach(btn => btn.disabled = !connected);
    }

    async handleConnect() {
        if (this.cdp.connected) {
            this.cdp.disconnect();
            this.setConnected(false);
            this.log('Disconnected from CDP', 'info');
            return;
        }

        const cdpUrl = this.cdpUrlInput.value.trim();
        if (!cdpUrl) {
            this.log('Please enter a CDP URL', 'error');
            return;
        }

        try {
            this.statusText.textContent = 'Connecting...';
            this.connectBtn.disabled = true;
            this.log(`Connecting to ${cdpUrl}...`, 'info');
            this.log(`Using CORS proxy: ${cdpUrl.replace(':9222', ':9224')}`, 'info');
            await this.cdp.connect(cdpUrl);
            this.setConnected(true);
            this.log('Connected to CDP successfully', 'success');
        } catch (error) {
            this.statusText.textContent = 'Disconnected';
            this.log(`Connection failed: ${error.message}`, 'error');
            console.error('Connection error:', error);
        } finally {
            this.connectBtn.disabled = false;
        }
    }

    async handleNavigate() {
        const url = this.urlInput.value.trim();
        if (!url) {
            this.log('Please enter a URL', 'error');
            return;
        }

        try {
            this.log(`Navigating to ${url}...`, 'info');
            await this.cdp.navigate(url);
            this.log(`Navigated to ${url}`, 'success');
        } catch (error) {
            this.log(`Navigation failed: ${error.message}`, 'error');
        }
    }

    async handleClick() {
        const selector = this.clickSelector.value.trim();
        if (!selector) {
            this.log('Please enter a CSS selector', 'error');
            return;
        }

        try {
            this.log(`Clicking element: ${selector}...`, 'info');
            await this.cdp.click(selector);
            this.log(`Clicked element: ${selector}`, 'success');
        } catch (error) {
            this.log(`Click failed: ${error.message}`, 'error');
        }
    }

    async handleType() {
        const selector = this.typeSelector.value.trim();
        const text = this.typeText.value;

        if (!selector) {
            this.log('Please enter a CSS selector', 'error');
            return;
        }
        if (!text) {
            this.log('Please enter text to type', 'error');
            return;
        }

        try {
            this.log(`Typing into ${selector}: "${text}"...`, 'info');
            await this.cdp.type(selector, text);
            this.log(`Typed text into ${selector}`, 'success');
        } catch (error) {
            this.log(`Type failed: ${error.message}`, 'error');
        }
    }

    async handleScreenshot() {
        try {
            this.log('Taking screenshot...', 'info');
            const base64 = await this.cdp.screenshot();

            // Display the screenshot
            this.screenshotPreview.innerHTML = `<img src="data:image/png;base64,${base64}" alt="Screenshot">`;
            this.log('Screenshot captured', 'success');
        } catch (error) {
            this.log(`Screenshot failed: ${error.message}`, 'error');
        }
    }

    handleRefreshVnc() {
        this.vncFrame.src = this.vncFrame.src;
        this.log('VNC viewer refreshed', 'info');
    }

    handleClearLog() {
        this.actionLog.innerHTML = '';
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    window.ui = new UIController();
});
