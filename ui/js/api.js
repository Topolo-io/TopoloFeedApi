/**
 * API Module - Handles all API interactions
 */

// Global reference to the current abort controller
let abortController = null;

/**
 * Shows a loading message
 * @param {string} message - The loading message to display
 */
function showLoading(message) {
    if (window.ui) {
        window.ui.showLoading(message);
    }
}

/**
 * Hides the loading message
 */
function hideLoading() {
    if (window.ui) {
        window.ui.hideLoading();
    }
}

/**
 * Performs a fetch with automatic retry
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} retryDelay - Delay between retries in ms
 * @returns {Promise<Response>} The fetch response
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3, retryDelay = 1000) {
    // Create a new AbortController for this request
    abortController = new AbortController();
    
    // Add the signal to the options
    const fetchOptions = {
        ...options,
        signal: abortController.signal
    };
    
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fetch(url, fetchOptions);
        } catch (error) {
            // If this was aborted, don't retry
            if (error.name === 'AbortError') {
                throw new Error('Request was cancelled');
            }
            
            console.log(`Fetch attempt ${attempt + 1}/${maxRetries} failed: ${error.message}`);
            lastError = error;
            
            if (attempt < maxRetries - 1) {
                // Show a message that we're retrying
                showLoading(`Connection attempt ${attempt + 1} failed, retrying in ${retryDelay/1000}s...`);
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }
    
    // If we get here, all retries failed
    throw new Error(`Failed after ${maxRetries} attempts. Last error: ${lastError.message}`);
}

/**
 * Cancels the current request
 */
function cancelRequest() {
    if (abortController) {
        abortController.abort();
    }
}

/**
 * Fetches feed data for a device
 * @param {string} deviceId - The device ID
 * @param {string} apiEndpoint - The API endpoint URL
 * @returns {Promise<Object>} The feed data
 */
async function fetchFeed(deviceId, apiEndpoint) {
    try {
        // Show loading
        showLoading(`Fetching media feed for device: ${deviceId}`);
        
        // Fetch from API with CORS mode specified and retry
        const response = await fetchWithRetry(`${apiEndpoint}/${deviceId}`, {
            method: 'GET',
            mode: 'cors',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const data = await response.json();
        
        // Hide loading
        hideLoading();
        
        return {
            success: response.ok,
            data: data
        };
    } catch (error) {
        // Make sure loading is hidden
        hideLoading();
        throw error;
    }
}

/**
 * Fetches KV data from the admin endpoint
 * @param {string} key - The KV key to fetch
 * @param {string} apiEndpoint - The API endpoint URL
 * @returns {Promise<Object>} The KV data
 */
async function fetchKV(key, apiEndpoint) {
    try {
        showLoading(`Fetching KV data: ${key}`);
        
        const response = await fetchWithRetry(`${apiEndpoint}/admin/kv/NODO_FEED_CONFIG/${key}`, {
            method: 'GET',
            mode: 'cors',
            headers: {
                'Accept': 'application/json'
            }
        });
        
        const data = await response.json();
        
        hideLoading();
        
        return {
            success: response.ok,
            data: data
        };
    } catch (error) {
        hideLoading();
        throw error;
    }
}

/**
 * Tests connection to an API endpoint
 * @param {string} apiEndpoint - The API endpoint URL
 * @returns {Promise<Object>} The test result
 */
async function testConnection(apiEndpoint) {
    try {
        showLoading(`Testing connection to: ${apiEndpoint}`);
        
        // First try health endpoint, then fall back to OPTIONS request
        try {
            // Try health endpoint first
            const healthResponse = await fetchWithRetry(`${apiEndpoint}/health`, {
                method: 'HEAD',
                mode: 'cors',
            }, 1);
            
            if (healthResponse.ok) {
                hideLoading();
                return {
                    success: true,
                    message: 'Successfully connected to the API health endpoint.'
                };
            }
        } catch (healthError) {
            console.log("Health endpoint not available, trying OPTIONS request...");
        }
        
        try {
            // Fall back to OPTIONS request to root endpoint
            const optionsResponse = await fetchWithRetry(apiEndpoint, {
                method: 'OPTIONS',
                mode: 'cors',
            }, 1);
            
            hideLoading();
            return {
                success: true,
                message: 'Successfully connected to the API endpoint. Note: No health endpoint found, but the API server is responding.'
            };
        } catch (optionsError) {
            throw new Error(`Connection failed: ${optionsError.message}. Please check if the API endpoint is correct and the server is running.`);
        }
    } catch (error) {
        hideLoading();
        return {
            success: false,
            message: error.message
        };
    }
}

// Export API functions
window.api = {
    fetchFeed,
    fetchKV,
    testConnection,
    cancelRequest
}; 