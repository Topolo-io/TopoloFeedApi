/**
 * Data Module - Manages application data
 */

// Global state
const state = {
    currentDeviceId: '',
    currentEndpoint: '',
    data: {
        feed: null,
        tenantMapping: null,
        baseFeed: null,
        tenantConfigs: {},
        categories: {}
    }
};

/**
 * Sets the current device ID and endpoint
 * @param {string} deviceId - The device ID
 * @param {string} endpoint - The API endpoint URL
 */
function setCurrentDevice(deviceId, endpoint) {
    state.currentDeviceId = deviceId;
    state.currentEndpoint = endpoint;
}

/**
 * Gets the current device ID and endpoint
 * @returns {Object} The current device info
 */
function getCurrentDevice() {
    return {
        deviceId: state.currentDeviceId,
        endpoint: state.currentEndpoint
    };
}

/**
 * Stores feed data in the data store
 * @param {Object} data - The feed data
 */
function storeFeedData(data) {
    state.data.feed = data;
}

/**
 * Stores KV data in the data store
 * @param {string} key - The KV key
 * @param {Object} data - The KV data
 */
function storeKVData(key, data) {
    if (key === 'tenant-mapping') {
        state.data.tenantMapping = data;
    } else if (key === 'feed') {
        state.data.baseFeed = data;
    } else if (key.includes('_tenant')) {
        state.data.tenantConfigs[key] = data;
    } else {
        state.data.categories[key] = data;
    }
}

/**
 * Gets data from the data store
 * @param {string} type - The type of data to get
 * @param {string} key - The specific key for the data type
 * @returns {Object} The requested data
 */
function getData(type, key) {
    switch (type) {
        case 'feed':
            return state.data.feed;
        case 'tenant-mapping':
            return state.data.tenantMapping;
        case 'base-feed':
            return state.data.baseFeed;
        case 'tenant':
            return key ? state.data.tenantConfigs[key] : null;
        case 'category':
            return key ? state.data.categories[key] : null;
        default:
            return null;
    }
}

// Export data functions
window.dataStore = {
    setCurrentDevice,
    getCurrentDevice,
    storeFeedData,
    storeKVData,
    getData
}; 