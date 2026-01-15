/**
 * UI Module - Handles all UI interactions and rendering
 */

// DOM Elements
const elements = {
    deviceForm: document.getElementById('deviceForm'),
    deviceIdInput: document.getElementById('deviceId'),
    apiEndpointInput: document.getElementById('apiEndpoint'),
    testConnectionBtn: document.getElementById('testConnectionBtn'),
    feedContainer: document.getElementById('feedContainer'),
    jsonOutput: document.getElementById('jsonOutput'),
    tenantInfo: document.getElementById('tenantInfo'),
    cancelLoadingBtn: document.getElementById('cancelLoadingBtn'),
    feedStats: {
        totalItems: document.getElementById('totalItems'),
        imageCount: document.getElementById('imageCount'),
        videoCount: document.getElementById('videoCount'),
        totalDuration: document.getElementById('totalDuration')
    },
    // KV fetch elements
    refreshCompiledFeed: document.getElementById('refreshCompiledFeed'),
    fetchTenantMapping: document.getElementById('fetchTenantMapping'),
    fetchBaseFeed: document.getElementById('fetchBaseFeed'),
    fetchTenantConfig: document.getElementById('fetchTenantConfig'),
    fetchCategories: document.getElementById('fetchCategories'),
    tenantMappingOutput: document.getElementById('tenantMappingOutput'),
    baseFeedOutput: document.getElementById('baseFeedOutput'),
    tenantConfigOutput: document.getElementById('tenantConfigOutput'),
    categoriesOutput: document.getElementById('categoriesOutput'),
    tenantConfigSelector: document.getElementById('tenantConfigSelector'),
    categoriesSelector: document.getElementById('categoriesSelector')
};

// Bootstrap components
const loadingModal = new bootstrap.Modal(document.getElementById('loadingModal'), {
    keyboard: false,
    backdrop: 'static'
});

// Track loading state
let isLoading = false;

/**
 * Shows the loading modal with a message
 * @param {string} message - The message to display
 */
function showLoading(message) {
    isLoading = true;
    document.getElementById('loadingMessage').textContent = message || 'Loading...';
    loadingModal.show();
}

/**
 * Hides the loading modal
 */
function hideLoading() {
    isLoading = false;
    if (loadingModal._isShown) {
        loadingModal.hide();
    }
}

/**
 * Updates the tenant information display
 * @param {Object} data - The feed data
 */
function updateTenantInfo(data) {
    try {
        // First check if the data has a tenant property
        if (data.tenant && typeof data.tenant === 'object') {
            const tenantId = data.tenant.id || 'Unknown';
            const tenantName = data.tenant.name || data.tenant.id || 'Unknown';
            const configPath = data.tenant.configPath || 'N/A';
            
            elements.tenantInfo.innerHTML = `
                <strong>Tenant ID:</strong> ${tenantId}<br>
                <strong>Name:</strong> ${tenantName}<br>
                <strong>Config Path:</strong> ${configPath}
            `;
            elements.tenantInfo.className = 'alert alert-info';
            
            // Also update the tenant selector
            updateTenantSelector(data.tenant);
            
            return;
        }
        
        // Fallback: Try to extract tenant info from the data
        // This handles cases where tenant info might be nested differently
        if (data && typeof data === 'object') {
            let tenantInfo = null;
            
            // Try to find tenant information in the top-level properties
            for (const key of ['tenant', 'tenantInfo', 'tenantData', 'tenantConfig']) {
                if (data[key] && typeof data[key] === 'object') {
                    tenantInfo = data[key];
                    break;
                }
            }
            
            if (tenantInfo) {
                const tenantId = tenantInfo.id || tenantInfo.tenantId || 'Unknown';
                const tenantName = tenantInfo.name || tenantInfo.displayName || tenantId;
                const configPath = tenantInfo.configPath || tenantInfo.config || 'N/A';
                
                elements.tenantInfo.innerHTML = `
                    <strong>Tenant ID:</strong> ${tenantId}<br>
                    <strong>Name:</strong> ${tenantName}<br>
                    <strong>Config Path:</strong> ${configPath}
                `;
                elements.tenantInfo.className = 'alert alert-info';
                
                // Also update the tenant selector
                updateTenantSelector(tenantInfo);
                
                return;
            }
        }
        
        // If we couldn't find tenant info, show a message
        elements.tenantInfo.textContent = "No tenant information available in the response";
        elements.tenantInfo.className = 'alert alert-warning';
    } catch (error) {
        console.error("Error updating tenant info:", error);
        elements.tenantInfo.textContent = "Error parsing tenant information";
        elements.tenantInfo.className = 'alert alert-danger';
    }
}

/**
 * Updates the tenant selector dropdown
 * @param {Object} tenant - The tenant information
 */
function updateTenantSelector(tenant) {
    if (!tenant || !tenant.id) return;
    
    const tenantOption = document.createElement('option');
    tenantOption.value = `${tenant.id}_tenant`;
    tenantOption.textContent = tenant.name || tenant.id;
    
    // Check if this tenant is already in the selector
    let exists = false;
    for (let i = 0; i < elements.tenantConfigSelector.options.length; i++) {
        if (elements.tenantConfigSelector.options[i].value === tenantOption.value) {
            exists = true;
            break;
        }
    }
    
    if (!exists) {
        elements.tenantConfigSelector.appendChild(tenantOption);
    }
    
    // Select this tenant
    elements.tenantConfigSelector.value = tenantOption.value;
}

/**
 * Updates the feed statistics
 * @param {Array} feedData - The feed data array
 */
function updateStats(feedData) {
    if (!feedData || !Array.isArray(feedData)) {
        elements.feedStats.totalItems.textContent = '-';
        elements.feedStats.imageCount.textContent = '-';
        elements.feedStats.videoCount.textContent = '-';
        elements.feedStats.totalDuration.textContent = '-';
        return;
    }
    
    const stats = {
        total: feedData.length,
        images: feedData.filter(item => item.type === 'image').length,
        videos: feedData.filter(item => item.type === 'video').length,
        duration: feedData.reduce((sum, item) => sum + (parseInt(item.duration) || 0), 0)
    };
    
    elements.feedStats.totalItems.textContent = stats.total;
    elements.feedStats.imageCount.textContent = stats.images;
    elements.feedStats.videoCount.textContent = stats.videos;
    elements.feedStats.totalDuration.textContent = `${stats.duration}s`;
}

/**
 * Displays the feed data in the UI
 * @param {Array} feedData - The feed data array
 */
function displayFeed(feedData) {
    // Update JSON output
    elements.jsonOutput.textContent = JSON.stringify(feedData, null, 2);
    
    // Handle empty feed
    if (!Array.isArray(feedData) || feedData.length === 0) {
        elements.feedContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-warning">
                    <h5>Empty Feed</h5>
                    <p>The feed contains no media items.</p>
                </div>
            </div>
        `;
        updateStats(feedData);
        return;
    }
    
    // Update stats
    updateStats(feedData);
    
    // Build the visual feed
    let feedHtml = '';
    
    feedData.forEach((item, index) => {
        const mediaId = item.id || `media-${index}`;
        const duration = item.duration || 'N/A';
        
        let mediaPreview = '';
        if (item.type === 'image') {
            mediaPreview = `
                <div class="position-relative">
                    <img src="${item.url}" alt="Media item ${mediaId}" class="media-preview">
                    <span class="duration-badge">${duration}s</span>
                </div>
            `;
        } else if (item.type === 'video') {
            mediaPreview = `
                <div class="position-relative">
                    <video src="${item.url}" controls class="media-preview"></video>
                    <span class="duration-badge">${duration}s</span>
                </div>
            `;
        } else {
            mediaPreview = `
                <div class="preview-placeholder">
                    <span>${item.type}</span>
                </div>
            `;
        }
        
        feedHtml += `
            <div class="col-md-6 col-lg-4">
                <div class="media-item">
                    <h6 class="media-title">${item.id || 'No ID'}</h6>
                    <div class="text-muted">${item.type}</div>
                    ${mediaPreview}
                    <div class="mt-2">
                        <small class="text-truncate d-block">${item.url}</small>
                    </div>
                </div>
            </div>
        `;
    });
    
    elements.feedContainer.innerHTML = feedHtml;
}

/**
 * Displays an error message in the UI
 * @param {string} message - The error message
 */
function showError(message) {
    elements.feedContainer.innerHTML = `
        <div class="col-12">
            <div class="alert alert-danger">
                <h5>Error</h5>
                <p>${message}</p>
            </div>
        </div>
    `;
    
    elements.jsonOutput.textContent = `Error: ${message}`;
    elements.tenantInfo.textContent = "Failed to fetch feed";
    elements.tenantInfo.className = 'alert alert-danger';
    updateStats(null);
}

/**
 * Updates the categories selector
 * @param {Object} baseConfig - The base feed configuration
 */
function updateCategoriesSelector(baseConfig) {
    if (!baseConfig || !baseConfig.contentCategories) return;
    
    // Clear existing options except the placeholder
    while (elements.categoriesSelector.options.length > 1) {
        elements.categoriesSelector.remove(1);
    }
    
    // Add categories from the base feed
    Object.keys(baseConfig.contentCategories).forEach(category => {
        const option = document.createElement('option');
        option.value = baseConfig.contentCategories[category].contentPath;
        option.textContent = category;
        elements.categoriesSelector.appendChild(option);
    });
}

/**
 * Updates the tenant mapping selector
 * @param {Object} mappingData - The tenant mapping data
 */
function updateTenantMappingSelector(mappingData) {
    if (!mappingData || !mappingData.mappings) return;
    
    // Clear existing options except the placeholder
    while (elements.tenantConfigSelector.options.length > 1) {
        elements.tenantConfigSelector.remove(1);
    }
    
    // Add tenants from the mapping
    mappingData.mappings.forEach(tenant => {
        const option = document.createElement('option');
        option.value = tenant.configPath;
        option.textContent = tenant.displayName || tenant.tenantId;
        elements.tenantConfigSelector.appendChild(option);
    });
    
    // Add default tenant if present
    if (mappingData.default) {
        const option = document.createElement('option');
        option.value = mappingData.default.configPath;
        option.textContent = 'Default';
        elements.tenantConfigSelector.appendChild(option);
    }
}

/**
 * Display KV data in a specific output element
 * @param {Object} data - The KV data
 * @param {HTMLElement} outputElement - The output element
 */
function displayKVData(data, outputElement) {
    outputElement.textContent = JSON.stringify(data, null, 2);
}

/**
 * Display connection test result
 * @param {Object} result - The connection test result
 */
function displayConnectionResult(result) {
    if (result.success) {
        elements.feedContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-success">
                    <h5>Connection Successful</h5>
                    <p>${result.message}</p>
                </div>
            </div>
        `;
    } else {
        elements.feedContainer.innerHTML = `
            <div class="col-12">
                <div class="alert alert-danger">
                    <h5>Connection Error</h5>
                    <p>${result.message}</p>
                </div>
            </div>
        `;
    }
}

// Export UI functions
window.ui = {
    elements,
    showLoading,
    hideLoading,
    updateTenantInfo,
    displayFeed,
    showError,
    updateCategoriesSelector,
    updateTenantMappingSelector,
    displayKVData,
    displayConnectionResult
}; 