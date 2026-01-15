/**
 * Main Application - Initializes and connects all modules
 */

document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
});

/**
 * Initialize the application
 */
function initializeApp() {
    // Set up event listeners
    setupEventListeners();
    
    // Check for URL parameters
    processUrlParameters();
    
    // Set up abort controller for unload events
    setupUnloadHandlers();
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
    // Device form submit
    ui.elements.deviceForm.addEventListener('submit', handleDeviceFormSubmit);
    
    // Test connection button
    ui.elements.testConnectionBtn.addEventListener('click', handleTestConnection);
    
    // Cancel loading button
    ui.elements.cancelLoadingBtn.addEventListener('click', handleCancelLoading);
    
    // KV data fetch buttons
    ui.elements.refreshCompiledFeed.addEventListener('click', handleRefreshCompiledFeed);
    ui.elements.fetchTenantMapping.addEventListener('click', handleFetchTenantMapping);
    ui.elements.fetchBaseFeed.addEventListener('click', handleFetchBaseFeed);
    ui.elements.fetchTenantConfig.addEventListener('click', handleFetchTenantConfig);
    ui.elements.fetchCategories.addEventListener('click', handleFetchCategories);
}

/**
 * Process URL parameters
 */
function processUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const deviceIdParam = urlParams.get('deviceId');
    
    if (deviceIdParam) {
        ui.elements.deviceIdInput.value = deviceIdParam;
        // Auto-submit
        ui.elements.deviceForm.dispatchEvent(new Event('submit'));
    }
}

/**
 * Set up unload handlers
 */
function setupUnloadHandlers() {
    window.addEventListener('beforeunload', function() {
        api.cancelRequest();
    });
}

/**
 * Handle device form submission
 * @param {Event} e - The submit event
 */
async function handleDeviceFormSubmit(e) {
    e.preventDefault();
    
    const deviceId = ui.elements.deviceIdInput.value.trim();
    const apiEndpoint = ui.elements.apiEndpointInput.value.trim();
    
    if (!deviceId) {
        alert('Please enter a device ID');
        return;
    }
    
    // Store the current device info
    dataStore.setCurrentDevice(deviceId, apiEndpoint);
    
    try {
        // Fetch feed data
        const result = await api.fetchFeed(deviceId, apiEndpoint);
        
        if (result.success) {
            // Store the feed data
            dataStore.storeFeedData(result.data);
            
            // Display feed
            ui.displayFeed(result.data);
            
            // Update tenant info
            ui.updateTenantInfo(result.data);
        } else {
            ui.showError(result.data.error || 'Unknown error');
        }
    } catch (error) {
        ui.showError(error.message);
    }
}

/**
 * Handle test connection button click
 */
async function handleTestConnection() {
    const apiEndpoint = ui.elements.apiEndpointInput.value.trim();
    
    if (!apiEndpoint) {
        alert('Please enter an API endpoint URL');
        return;
    }
    
    try {
        const result = await api.testConnection(apiEndpoint);
        ui.displayConnectionResult(result);
    } catch (error) {
        ui.showError(error.message);
    }
}

/**
 * Handle cancel loading button click
 */
function handleCancelLoading() {
    api.cancelRequest();
    ui.hideLoading();
}

/**
 * Handle refresh compiled feed button click
 */
function handleRefreshCompiledFeed() {
    const currentDevice = dataStore.getCurrentDevice();
    
    if (!currentDevice.deviceId || !currentDevice.endpoint) {
        alert('Please fetch a feed first (enter a device ID and click "Get Feed")');
        return;
    }
    
    handleDeviceFormSubmit(new Event('submit'));
}

/**
 * Handle fetch tenant mapping button click
 */
async function handleFetchTenantMapping() {
    const apiEndpoint = ui.elements.apiEndpointInput.value.trim();
    
    try {
        const result = await api.fetchKV('tenant-mapping', apiEndpoint);
        
        if (result.success) {
            // Store the data
            dataStore.storeKVData('tenant-mapping', result.data);
            
            // Update the UI
            ui.displayKVData(result.data, ui.elements.tenantMappingOutput);
            ui.updateTenantMappingSelector(result.data);
        } else {
            ui.elements.tenantMappingOutput.textContent = `Error: ${result.data.error || 'Unknown error'}`;
        }
    } catch (error) {
        ui.elements.tenantMappingOutput.textContent = `Error: ${error.message}`;
    }
}

/**
 * Handle fetch base feed button click
 */
async function handleFetchBaseFeed() {
    const apiEndpoint = ui.elements.apiEndpointInput.value.trim();
    
    try {
        const result = await api.fetchKV('feed', apiEndpoint);
        
        if (result.success) {
            // Store the data
            dataStore.storeKVData('feed', result.data);
            
            // Update the UI
            ui.displayKVData(result.data, ui.elements.baseFeedOutput);
            ui.updateCategoriesSelector(result.data);
        } else {
            ui.elements.baseFeedOutput.textContent = `Error: ${result.data.error || 'Unknown error'}`;
        }
    } catch (error) {
        ui.elements.baseFeedOutput.textContent = `Error: ${error.message}`;
    }
}

/**
 * Handle fetch tenant config button click
 */
async function handleFetchTenantConfig() {
    const tenant = ui.elements.tenantConfigSelector.value;
    const apiEndpoint = ui.elements.apiEndpointInput.value.trim();
    
    if (!tenant) {
        alert('Please select a tenant');
        return;
    }
    
    try {
        const result = await api.fetchKV(tenant, apiEndpoint);
        
        if (result.success) {
            // Store the data
            dataStore.storeKVData(tenant, result.data);
            
            // Update the UI
            ui.displayKVData(result.data, ui.elements.tenantConfigOutput);
        } else {
            ui.elements.tenantConfigOutput.textContent = `Error: ${result.data.error || 'Unknown error'}`;
        }
    } catch (error) {
        ui.elements.tenantConfigOutput.textContent = `Error: ${error.message}`;
    }
}

/**
 * Handle fetch categories button click
 */
async function handleFetchCategories() {
    const category = ui.elements.categoriesSelector.value;
    const apiEndpoint = ui.elements.apiEndpointInput.value.trim();
    
    if (!category) {
        alert('Please select a category');
        return;
    }
    
    try {
        const result = await api.fetchKV(category, apiEndpoint);
        
        if (result.success) {
            // Store the data
            dataStore.storeKVData(category, result.data);
            
            // Update the UI
            ui.displayKVData(result.data, ui.elements.categoriesOutput);
        } else {
            ui.elements.categoriesOutput.textContent = `Error: ${result.data.error || 'Unknown error'}`;
        }
    } catch (error) {
        ui.elements.categoriesOutput.textContent = `Error: ${error.message}`;
    }
}

// Add global utility for alternative endpoints
window.useAlternativeEndpoint = function(endpoint) {
    ui.elements.apiEndpointInput.value = endpoint;
    ui.elements.testConnectionBtn.click();
}; 