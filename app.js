// PWA Configuration
const API_BASE_URL = 'https://api.openweathermap.org/data/2.5';
const GEOCODING_API_URL = 'https://api.openweathermap.org/geo/1.0';

// USGS Water Data API Configuration
const USGS_API_BASE_URL = 'https://waterservices.usgs.gov/nwis';
const USGS_SITE_API_URL = 'https://waterservices.usgs.gov/nwis/site';
const USGS_IV_API_URL = 'https://waterservices.usgs.gov/nwis/iv'; // Instantaneous Values
const WATER_TEMP_PARAM_CODE = '00010'; // Water temperature in Celsius
const WATER_TEMP_PARAM_CODE_F = '00011'; // Water temperature in Fahrenheit

// App State
let currentLocation = null;
let weatherData = null;
let pressureHistory = [];
let temperatureHistory = [];
let waterTemperatureHistory = [];
let deferredPrompt = null;
let recentLocations = [];
let isSearching = false;
let usgsWaterData = null;
let nearbyWaterBodies = [];
let currentWaterBody = null;
let selectedState = null;
let selectedWaterType = null;
let isWaterDataLoading = false;
let isUsingEstimatedWaterTemp = false;

// DOM Elements - will be initialized when DOM is ready
let locationBtn, themeToggleBtn, installBanner, installBtn, bannerClose, navBtns;
let locationName, locationCoords, locationSearch, searchBtn, searchResults, recentLocationsDiv;
let breakdownContent, moonPhaseElement, moonIconElement, stateSelector, waterTypeSelector;

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    // Check if configuration is loaded
    if (typeof CONFIG === 'undefined') {
        console.error('Configuration not loaded! Please make sure config.js exists and is properly configured.');
        showConfigError();
        return;
    }
    
    // Check if API key is set
    if (!CONFIG.WEATHER_API_KEY || CONFIG.WEATHER_API_KEY === 'your-openweathermap-api-key-here') {
        console.error('Weather API key not configured! Please set your OpenWeatherMap API key in config.js');
        showConfigError('API key not configured');
        return;
    }
    
    initializeDOMElements();
    initializeApp();
    setupEventListeners();
    registerServiceWorker();
});

// Initialize DOM Elements
function initializeDOMElements() {
    locationBtn = document.getElementById('locationBtn');
    themeToggleBtn = document.getElementById('themeToggleBtn');
    installBanner = document.getElementById('installBanner');
    installBtn = document.getElementById('installBtn');
    bannerClose = document.getElementById('bannerClose');
    navBtns = document.querySelectorAll('.nav-btn');
    locationName = document.getElementById('locationName');
    locationCoords = document.getElementById('locationCoords');
    locationSearch = document.getElementById('locationSearch');
    searchBtn = document.getElementById('searchBtn');
    searchResults = document.getElementById('searchResults');
    recentLocationsDiv = document.getElementById('recentLocations');
    breakdownContent = document.getElementById('breakdownContent');
    moonPhaseElement = document.getElementById('moonPhase');
    moonIconElement = document.getElementById('moonIcon');
    stateSelector = document.getElementById('stateSelector');
    waterTypeSelector = document.getElementById('waterTypeSelector');
    
    // Debug: Check if theme toggle button is found
    console.log('Theme toggle button found:', themeToggleBtn);
}

// Initialize Application
function initializeApp() {
    // Try to get location on load
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLocation = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude
                };
                
                // Detect and set the user's state
                const detectedState = detectStateFromCoordinates(position.coords.latitude, position.coords.longitude);
                if (detectedState) {
                    setSelectedState(detectedState);
                }
                
                updateLocationUI();
                fetchWeatherData();
                
                // Find nearest USGS water temperature data
                showWaterDataLoading();
                findNearestUSGSWaterData(position.coords.latitude, position.coords.longitude);
            },
            (error) => {
                console.log('Location access denied:', error);
                // Use default location (example: Chicago)
                currentLocation = { lat: 41.8781, lon: -87.6298 };
                
                // Set default state for Chicago
                setSelectedState('IL');
                
                fetchWeatherData();
                
                // Find nearest USGS water temperature data for default location
                showWaterDataLoading();
                findNearestUSGSWaterData(41.8781, -87.6298);
            }
        );
    }
    
    // Load stored data
    loadStoredData();
    
    // Initialize charts
    initializeCharts();
    
    // Set default score color
    updateScoreColor(50);
    
    // Update moon phase
    updateMoonPhase();
    
    // Initialize theme
    initializeTheme();
}

// Event Listeners
function setupEventListeners() {
    // Add null checks and logging for debugging
    if (locationBtn) {
        locationBtn.addEventListener('click', getLocation);
    } else {
        console.error('locationBtn not found');
    }
    
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', toggleTheme);
        console.log('Theme toggle event listener added successfully');
    } else {
        console.error('themeToggleBtn not found');
    }
    
    if (installBtn) {
        installBtn.addEventListener('click', installApp);
    } else {
        console.error('installBtn not found');
    }
    
    if (bannerClose) {
        bannerClose.addEventListener('click', closeBanner);
    } else {
        console.error('bannerClose not found');
    }
    
    // State Selector
    if (stateSelector) {
        stateSelector.addEventListener('change', handleStateChange);
    } else {
        console.error('stateSelector not found');
    }
    
    // Water Type Selector
    if (waterTypeSelector) {
        waterTypeSelector.addEventListener('change', handleWaterTypeChange);
    } else {
        console.error('waterTypeSelector not found');
    }
    
    // Location Search
    if (searchBtn) {
        searchBtn.addEventListener('click', performSearch);
    } else {
        console.error('searchBtn not found');
    }
    
    if (locationSearch) {
        locationSearch.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                performSearch();
            }
        });
        
        // Location Search Input
        locationSearch.addEventListener('input', debounce(handleSearchInput, 300));
    } else {
        console.error('locationSearch not found');
    }
    
    // Click outside to close search results
    document.addEventListener('click', (e) => {
        if (!searchResults.contains(e.target) && !locationSearch.contains(e.target)) {
            hideSearchResults();
        }
        
    });
    
    // Navigation
    navBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const section = e.currentTarget.dataset.section;
            switchSection(section);
        });
    });
    
    // PWA Install Events
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showInstallBanner();
    });
    
    // Check if app is already installed
    window.addEventListener('appinstalled', () => {
        console.log('App was installed');
        const installData = loadFromStorage('installPromptData') || {
            promptCount: 0,
            lastDismissedDate: null,
            installed: false
        };
        
        installData.installed = true;
        saveToStorage('installPromptData', installData);
        
        // Hide banner if visible
        installBanner.classList.remove('show');
    });
    
    // Score expand button
    const scoreExpandBtn = document.getElementById('scoreExpandBtn');
    if (scoreExpandBtn) {
        scoreExpandBtn.addEventListener('click', () => {
            const detailedBreakdown = document.getElementById('detailedBreakdown');
            const isExpanded = scoreExpandBtn.getAttribute('aria-expanded') === 'true';
            
            if (isExpanded) {
                detailedBreakdown.classList.remove('show');
                scoreExpandBtn.setAttribute('aria-expanded', 'false');
            } else {
                detailedBreakdown.classList.add('show');
                scoreExpandBtn.setAttribute('aria-expanded', 'true');
            }
        });
        
        // Initialize expand button state
        scoreExpandBtn.setAttribute('aria-expanded', 'false');
    }
}

// Theme Management
function initializeTheme() {
    // Check for saved theme preference or default to system preference
    const savedTheme = loadFromStorage('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    if (savedTheme === 'dark' || (savedTheme === null && prefersDark)) {
        enableDarkMode();
    } else {
        disableDarkMode();
    }
    
    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        const savedTheme = loadFromStorage('theme');
        if (savedTheme === null) { // Only auto-switch if user hasn't manually set a preference
            if (e.matches) {
                enableDarkMode();
            } else {
                disableDarkMode();
            }
        }
    });
}

function toggleTheme() {
    console.log('toggleTheme called');
    const isDark = document.documentElement.classList.contains('dark-mode');
    console.log('Current theme is dark:', isDark);
    
    if (isDark) {
        console.log('Switching to light mode');
        disableDarkMode();
    } else {
        console.log('Switching to dark mode');
        enableDarkMode();
    }
}

function enableDarkMode() {
    document.documentElement.classList.add('dark-mode');
    themeToggleBtn.classList.add('dark-active');
    themeToggleBtn.querySelector('.theme-icon').textContent = 'light_mode';
    saveToStorage('theme', 'dark');
    
    // Redraw charts with new theme colors
    updatePressureChart();
    updateTemperatureChart();
    updateWaterTemperatureChart();
}

function disableDarkMode() {
    document.documentElement.classList.remove('dark-mode');
    themeToggleBtn.classList.remove('dark-active');
    themeToggleBtn.querySelector('.theme-icon').textContent = 'dark_mode';
    saveToStorage('theme', 'light');
    
    // Redraw charts with new theme colors
    updatePressureChart();
    updateTemperatureChart();
    updateWaterTemperatureChart();
}

// Loading Indicators
function showWaterDataLoading() {
    isWaterDataLoading = true;
    
    const waterTempElement = document.getElementById('waterTemp');
    const fishingScoreElement = document.getElementById('fishingScore');
    const scoreDescriptionElement = document.getElementById('scoreDescription');
    
    // Show loading in water temperature
    waterTempElement.textContent = 'Loading...';
    waterTempElement.title = 'Fetching water temperature data...';
    waterTempElement.style.color = '#64748b';
    waterTempElement.style.fontWeight = 'normal';
    waterTempElement.classList.add('loading-pulse');
    
    // Show loading in fishing score
    fishingScoreElement.textContent = '--';
    scoreDescriptionElement.textContent = 'Recalculating...';
    
    // Show loading in breakdown
    const breakdownContent = document.getElementById('breakdownContent');
    breakdownContent.innerHTML = '<div class="breakdown-loading">Updating with new water data...</div>';
}

function hideWaterDataLoading() {
    // Clear loading state
    isWaterDataLoading = false;
    
    // Re-enable water type selector
    if (waterTypeSelector) {
        waterTypeSelector.disabled = false;
        waterTypeSelector.style.opacity = '1';
    }
    
    // Clear loading pulse animation from water temperature element
    const waterTempElement = document.getElementById('waterTemp');
    if (waterTempElement) {
        waterTempElement.classList.remove('loading-pulse');
    }
}

// State Detection and Management
function detectStateFromCoordinates(lat, lon) {
    // Simple state detection based on latitude and longitude bounds
    // This is a basic implementation - for production use, you'd want a more accurate service
    const stateBounds = {
        'AL': { minLat: 30.2, maxLat: 35.0, minLon: -88.5, maxLon: -84.9 },
        'AK': { minLat: 54.0, maxLat: 71.4, minLon: -180.0, maxLon: -129.0 },
        'AZ': { minLat: 31.3, maxLat: 37.0, minLon: -114.8, maxLon: -109.0 },
        'AR': { minLat: 33.0, maxLat: 36.5, minLon: -94.6, maxLon: -89.6 },
        'CA': { minLat: 32.5, maxLat: 42.0, minLon: -124.5, maxLon: -114.1 },
        'CO': { minLat: 37.0, maxLat: 41.0, minLon: -109.1, maxLon: -102.0 },
        'CT': { minLat: 40.9, maxLat: 42.1, minLon: -73.8, maxLon: -71.8 },
        'DE': { minLat: 38.4, maxLat: 39.8, minLon: -75.8, maxLon: -75.0 },
        'FL': { minLat: 24.4, maxLat: 31.0, minLon: -87.6, maxLon: -80.0 },
        'GA': { minLat: 30.3, maxLat: 35.0, minLon: -85.6, maxLon: -80.8 },
        'HI': { minLat: 18.9, maxLat: 28.4, minLon: -178.3, maxLon: -154.8 },
        'ID': { minLat: 42.0, maxLat: 49.0, minLon: -117.2, maxLon: -111.0 },
        'IL': { minLat: 36.9, maxLat: 42.5, minLon: -91.5, maxLon: -87.0 },
        'IN': { minLat: 37.8, maxLat: 41.8, minLon: -88.1, maxLon: -84.8 },
        'IA': { minLat: 40.4, maxLat: 43.5, minLon: -96.6, maxLon: -90.1 },
        'KS': { minLat: 37.0, maxLat: 40.0, minLon: -102.1, maxLon: -94.6 },
        'KY': { minLat: 36.5, maxLat: 39.1, minLon: -89.6, maxLon: -81.9 },
        'LA': { minLat: 29.0, maxLat: 33.0, minLon: -94.0, maxLon: -88.8 },
        'ME': { minLat: 43.1, maxLat: 47.5, minLon: -71.1, maxLon: -66.9 },
        'MD': { minLat: 37.9, maxLat: 39.7, minLon: -79.5, maxLon: -75.0 },
        'MA': { minLat: 41.2, maxLat: 42.9, minLon: -73.5, maxLon: -69.9 },
        'MI': { minLat: 41.7, maxLat: 48.2, minLon: -90.4, maxLon: -82.4 },
        'MN': { minLat: 43.5, maxLat: 49.4, minLon: -97.2, maxLon: -89.5 },
        'MS': { minLat: 30.2, maxLat: 35.0, minLon: -91.7, maxLon: -88.1 },
        'MO': { minLat: 36.0, maxLat: 40.6, minLon: -95.8, maxLon: -89.1 },
        'MT': { minLat: 45.0, maxLat: 49.0, minLon: -116.1, maxLon: -104.0 },
        'NE': { minLat: 40.0, maxLat: 43.0, minLon: -104.1, maxLon: -95.3 },
        'NV': { minLat: 35.0, maxLat: 42.0, minLon: -120.0, maxLon: -114.0 },
        'NH': { minLat: 42.7, maxLat: 45.3, minLon: -72.6, maxLon: -70.6 },
        'NJ': { minLat: 38.9, maxLat: 41.4, minLon: -75.6, maxLon: -73.9 },
        'NM': { minLat: 31.3, maxLat: 37.0, minLon: -109.1, maxLon: -103.0 },
        'NY': { minLat: 40.5, maxLat: 45.0, minLon: -79.8, maxLon: -71.8 },
        'NC': { minLat: 33.8, maxLat: 36.6, minLon: -84.3, maxLon: -75.4 },
        'ND': { minLat: 45.9, maxLat: 49.0, minLon: -104.1, maxLon: -96.6 },
        'OH': { minLat: 38.4, maxLat: 42.0, minLon: -84.8, maxLon: -80.5 },
        'OK': { minLat: 33.6, maxLat: 37.0, minLon: -103.0, maxLon: -94.4 },
        'OR': { minLat: 42.0, maxLat: 46.3, minLon: -124.6, maxLon: -116.5 },
        'PA': { minLat: 39.7, maxLat: 42.3, minLon: -80.5, maxLon: -74.7 },
        'RI': { minLat: 41.1, maxLat: 42.0, minLon: -71.9, maxLon: -71.1 },
        'SC': { minLat: 32.0, maxLat: 35.2, minLon: -83.4, maxLon: -78.5 },
        'SD': { minLat: 42.5, maxLat: 45.9, minLon: -104.1, maxLon: -96.4 },
        'TN': { minLat: 35.0, maxLat: 36.7, minLon: -90.3, maxLon: -81.6 },
        'TX': { minLat: 25.8, maxLat: 36.5, minLon: -106.6, maxLon: -93.5 },
        'UT': { minLat: 37.0, maxLat: 42.0, minLon: -114.1, maxLon: -109.0 },
        'VT': { minLat: 42.7, maxLat: 45.0, minLon: -73.4, maxLon: -71.5 },
        'VA': { minLat: 36.5, maxLat: 39.5, minLon: -83.7, maxLon: -75.2 },
        'WA': { minLat: 45.5, maxLat: 49.0, minLon: -124.8, maxLon: -116.9 },
        'WV': { minLat: 37.2, maxLat: 40.6, minLon: -82.6, maxLon: -77.7 },
        'WI': { minLat: 42.5, maxLat: 47.1, minLon: -92.9, maxLon: -86.2 },
        'WY': { minLat: 41.0, maxLat: 45.0, minLon: -111.1, maxLon: -104.0 }
    };
    
    // Check which state the coordinates fall within
    for (const [state, bounds] of Object.entries(stateBounds)) {
        if (lat >= bounds.minLat && lat <= bounds.maxLat && 
            lon >= bounds.minLon && lon <= bounds.maxLon) {
            return state;
        }
    }
    
    return null; // No state found
}

function setSelectedState(stateCode) {
    selectedState = stateCode;
    stateSelector.value = stateCode;
    
    // Enable search when state is selected
    locationSearch.disabled = false;
    searchBtn.disabled = false;
    updateSearchPlaceholder();
    
    // Save selected state to storage
    saveToStorage('selectedState', stateCode);
}

function updateSearchPlaceholder() {
    if (!selectedState) {
        locationSearch.placeholder = 'Search for cities...';
        return;
    }
    
    const stateName = getStateName(selectedState);
    locationSearch.placeholder = `Search for cities in ${stateName}...`;
}

function handleStateChange() {
    const newState = stateSelector.value;
    
    if (newState) {
        setSelectedState(newState);
        
        // Clear search input and results
        locationSearch.value = '';
        hideSearchResults();
        
        // Clear current water body selection data for the new state
        currentWaterBody = null;
        usgsWaterData = null;
        nearbyWaterBodies = [];
        
        // Clear water temperature history from previous state
        waterTemperatureHistory = [];
        
        // If we have a current location, re-fetch water bodies for the new state
        if (currentLocation && currentLocation.lat && currentLocation.lon) {
            console.log(`State changed to ${newState}, re-fetching water bodies for current location...`);
            
            // Show loading indicators
            showWaterDataLoading();
            
            // Re-fetch nearby water bodies with the new state
            findNearestUSGSWaterData(currentLocation.lat, currentLocation.lon);
        } else {
            // No current location set, show water bodies in the state and select closest to geographic center
            console.log(`State selected: ${newState}, showing water bodies in state and selecting closest to center`);
            showWaterDataLoading();
            findDefaultWaterBodyForState(newState);
        }
        
        // Update water temperature display (will show estimated temp while loading)
        updateWaterTemperatureDisplay();
        
        // Recalculate fishing score
        calculateFishingScore();
    } else {
        // Disable search when no state is selected
        selectedState = null;
        locationSearch.disabled = true;
        searchBtn.disabled = true;
        updateSearchPlaceholder();
        locationSearch.value = '';
        hideSearchResults();
        
        // Clear water body selection when no state is selected
        currentWaterBody = null;
        usgsWaterData = null;
        nearbyWaterBodies = [];
        waterTemperatureHistory = [];
        
        const waterBodySelection = document.getElementById('waterBodySelection');
        if (waterBodySelection) {
            waterBodySelection.innerHTML = `
                <div class="no-water-bodies">
                    <div class="no-water-bodies-icon">🌊</div>
                    <div class="no-water-bodies-text">Select a state first</div>
                    <div class="no-water-bodies-subtext">Water temperature will be estimated from air temperature</div>
                </div>
            `;
        }
        
        // Update displays
        updateWaterTemperatureDisplay();
        calculateFishingScore();
    }
}

function handleWaterTypeChange() {
    selectedWaterType = waterTypeSelector.value;
    
    // Save selected water type to storage
    saveToStorage('selectedWaterType', selectedWaterType);
    
    console.log(`Water type filter changed to: ${selectedWaterType || 'All'}`);
    
    // Re-fetch nearby water bodies with the new filter if we have a current location
    if (currentLocation && currentLocation.lat && currentLocation.lon) {
        console.log('Re-fetching nearby water bodies with new water type filter...');
        
        // Show loading indicators
        showWaterDataLoading();
        
        // Add loading indicator to water type selector
        waterTypeSelector.disabled = true;
        waterTypeSelector.style.opacity = '0.7';
        
        findNearestUSGSWaterData(currentLocation.lat, currentLocation.lon);
    }
}

function getStateName(stateCode) {
    const stateNames = {
        'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
        'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
        'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
        'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
        'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
        'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
        'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
        'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
        'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
        'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
        'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
        'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
        'WI': 'Wisconsin', 'WY': 'Wyoming'
    };
    
    return stateNames[stateCode] || stateCode;
}

function estimateWaterTemperatureFromAir() {
    if (!weatherData || !weatherData.forecast) {
        console.log('No weather data or forecast available for estimation');
        return null;
    }
    
    // Check if forecast is an array
    if (!Array.isArray(weatherData.forecast)) {
        console.log('Forecast is not an array:', typeof weatherData.forecast, weatherData.forecast);
        
        // Try to use current weather data as fallback
        if (weatherData.main && weatherData.main.temp) {
            console.log('Using current weather data for estimation');
            const currentTemp = weatherData.main.temp;
            const currentMonth = new Date().getMonth();
            
            // Apply seasonal adjustment
            let seasonalOffset = 0;
            if (currentMonth >= 5 && currentMonth <= 8) { // June-September (summer)
                seasonalOffset = 2;
            } else if (currentMonth >= 2 && currentMonth <= 4) { // March-May (spring)
                seasonalOffset = -3;
            } else if (currentMonth >= 9 && currentMonth <= 11) { // October-December (fall)
                seasonalOffset = 1;
            } else { // December-February (winter)
                seasonalOffset = -5;
            }
            
            const estimatedWaterTemp = currentTemp - 10 + seasonalOffset;
            
            console.log(`Estimated water temperature from current data: ${estimatedWaterTemp.toFixed(1)}°F (from current air temp ${currentTemp.toFixed(1)}°F)`);
            
            return {
                temperature_f: estimatedWaterTemp,
                temperature_c: (estimatedWaterTemp - 32) * 5 / 9,
                source: 'estimated_from_current_air',
                avg_air_temp_f: currentTemp,
                seasonal_offset: seasonalOffset,
                days_used: 0
            };
        }
        
        return null;
    }
    
    // Get the last 5 days of forecast data (high and low temperatures)
    const forecast = weatherData.forecast.slice(0, 5);
    
    if (forecast.length === 0) {
        return null;
    }
    
    // Calculate average high and low temperatures
    let totalHigh = 0;
    let totalLow = 0;
    let validDays = 0;
    
    forecast.forEach(day => {
        if (day.temp && day.temp.max !== undefined && day.temp.min !== undefined) {
            totalHigh += day.temp.max;
            totalLow += day.temp.min;
            validDays++;
        }
    });
    
    if (validDays === 0) {
        return null;
    }
    
    const avgHigh = totalHigh / validDays;
    const avgLow = totalLow / validDays;
    const avgAirTemp = (avgHigh + avgLow) / 2;
    
    // Water temperature estimation:
    // - Water is generally 5-15°F cooler than air temperature
    // - Use 10°F difference as a reasonable middle ground
    // - Add seasonal adjustment: warmer offset in summer, cooler in winter
    const currentMonth = new Date().getMonth(); // 0-11
    let seasonalOffset = 0;
    
    // Seasonal adjustments (water retains heat longer in winter, slower to warm in spring)
    if (currentMonth >= 5 && currentMonth <= 8) { // June-September (summer)
        seasonalOffset = 2; // Water closer to air temp in summer
    } else if (currentMonth >= 2 && currentMonth <= 4) { // March-May (spring)
        seasonalOffset = -3; // Water stays cooler in spring
    } else if (currentMonth >= 9 && currentMonth <= 11) { // October-December (fall)
        seasonalOffset = 1; // Water retains some summer heat
    } else { // December-February (winter)
        seasonalOffset = -5; // Water much cooler than air in winter
    }
    
    const estimatedWaterTemp = avgAirTemp - 10 + seasonalOffset;
    
    console.log(`Estimated water temperature: ${estimatedWaterTemp.toFixed(1)}°F (from avg air temp ${avgAirTemp.toFixed(1)}°F with seasonal offset ${seasonalOffset}°F)`);
    
    return {
        temperature_f: estimatedWaterTemp,
        temperature_c: (estimatedWaterTemp - 32) * 5 / 9,
        source: 'estimated_from_air',
        avg_air_temp_f: avgAirTemp,
        seasonal_offset: seasonalOffset,
        days_used: validDays
    };
}

function useEstimatedWaterTemperature(site) {
    console.log(`Using estimated water temperature for ${site.site_name} (no real temperature data available)`);
    
    const estimatedTemp = estimateWaterTemperatureFromAir();
    
    if (estimatedTemp) {
        usgsWaterData = {
            site: site,
            temperature: {
                temperature_f: estimatedTemp.temperature_f,
                temperature_c: estimatedTemp.temperature_c,
                datetime: new Date().toISOString(),
                site_no: site.site_no,
                estimated: true,
                estimation_details: estimatedTemp
            }
        };
        isUsingEstimatedWaterTemp = true;
        
        // Clear water temperature history since we don't have historical data
        waterTemperatureHistory = [];
        
        console.log(`Set estimated water temperature: ${estimatedTemp.temperature_f.toFixed(1)}°F for ${site.site_name}`);
        
        // Explicitly update the display with the estimated temperature
        updateWaterTemperatureDisplay();
    } else {
        console.log('Failed to estimate water temperature - no weather data available');
        usgsWaterData = null;
        isUsingEstimatedWaterTemp = false;
        
        // Update display to show no data available
        updateWaterTemperatureDisplay();
    }
}

function getStateCenterCoordinates(stateCode) {
    // Approximate geographic centers of each state
    const stateCenters = {
        'AL': { lat: 32.7, lon: -86.8 },
        'AK': { lat: 64.0, lon: -153.0 },
        'AZ': { lat: 34.2, lon: -111.5 },
        'AR': { lat: 34.8, lon: -92.2 },
        'CA': { lat: 37.3, lon: -119.3 },
        'CO': { lat: 39.0, lon: -105.5 },
        'CT': { lat: 41.6, lon: -72.7 },
        'DE': { lat: 39.0, lon: -75.5 },
        'FL': { lat: 27.7, lon: -81.7 },
        'GA': { lat: 33.2, lon: -83.4 },
        'HI': { lat: 21.3, lon: -157.8 },
        'ID': { lat: 44.3, lon: -114.6 },
        'IL': { lat: 40.0, lon: -89.2 },
        'IN': { lat: 39.8, lon: -86.3 },
        'IA': { lat: 42.0, lon: -93.6 },
        'KS': { lat: 38.5, lon: -98.4 },
        'KY': { lat: 37.8, lon: -84.3 },
        'LA': { lat: 31.0, lon: -92.0 },
        'ME': { lat: 45.2, lon: -69.2 },
        'MD': { lat: 39.0, lon: -76.8 },
        'MA': { lat: 42.3, lon: -71.8 },
        'MI': { lat: 44.3, lon: -85.6 },
        'MN': { lat: 46.4, lon: -94.7 },
        'MS': { lat: 32.7, lon: -89.7 },
        'MO': { lat: 38.3, lon: -92.4 },
        'MT': { lat: 47.0, lon: -110.0 },
        'NE': { lat: 41.5, lon: -99.9 },
        'NV': { lat: 38.5, lon: -117.0 },
        'NH': { lat: 43.9, lon: -71.5 },
        'NJ': { lat: 40.2, lon: -74.7 },
        'NM': { lat: 34.8, lon: -106.2 },
        'NY': { lat: 43.0, lon: -75.0 },
        'NC': { lat: 35.8, lon: -80.8 },
        'ND': { lat: 47.5, lon: -100.3 },
        'OH': { lat: 40.4, lon: -82.7 },
        'OK': { lat: 35.6, lon: -96.9 },
        'OR': { lat: 44.0, lon: -120.5 },
        'PA': { lat: 40.3, lon: -77.2 },
        'RI': { lat: 41.6, lon: -71.5 },
        'SC': { lat: 33.8, lon: -80.9 },
        'SD': { lat: 44.3, lon: -100.3 },
        'TN': { lat: 35.7, lon: -86.0 },
        'TX': { lat: 31.1, lon: -97.6 },
        'UT': { lat: 39.3, lon: -111.1 },
        'VT': { lat: 44.0, lon: -72.7 },
        'VA': { lat: 37.8, lon: -78.2 },
        'WA': { lat: 47.4, lon: -121.5 },
        'WV': { lat: 38.5, lon: -80.9 },
        'WI': { lat: 44.3, lon: -89.8 },
        'WY': { lat: 43.1, lon: -107.6 }
    };
    
    return stateCenters[stateCode] || { lat: 39.8, lon: -98.6 }; // Default to center of US
}

async function findDefaultWaterBodyForState(stateCode) {
    try {
        console.log(`Finding default water body for state: ${stateCode}`);
        
        // Get the geographic center of the state
        const stateCenter = getStateCenterCoordinates(stateCode);
        console.log(`State center coordinates: ${stateCenter.lat}, ${stateCenter.lon}`);
        
        // Find water bodies in the state
        const waterBodies = await findNearbyWaterSites(stateCenter.lat, stateCenter.lon, 500); // Large radius to cover state
        
        if (waterBodies.length === 0) {
            console.log(`No water bodies found in ${stateCode}`);
            hideWaterDataLoading();
            
            const waterBodySelection = document.getElementById('waterBodySelection');
            if (waterBodySelection) {
                waterBodySelection.innerHTML = `
                    <div class="no-water-bodies">
                        <div class="no-water-bodies-icon">🌊</div>
                        <div class="no-water-bodies-text">No water bodies found in ${getStateName(stateCode)}</div>
                        <div class="no-water-bodies-subtext">Water temperature will be estimated from air temperature</div>
                    </div>
                `;
            }
            return;
        }
        
        // Select the closest water body to the state center (first one is already closest due to sorting)
        const selectedWaterBody = waterBodies[0];
        console.log(`Auto-selecting water body: ${selectedWaterBody.site_name} (${selectedWaterBody.distance.toFixed(1)}km from center)`);
        
        // Set this as the current water body and location
        currentWaterBody = selectedWaterBody;
        currentLocation = {
            lat: selectedWaterBody.latitude,
            lon: selectedWaterBody.longitude,
            name: selectedWaterBody.site_name
        };
        
        // Store all nearby water bodies
        nearbyWaterBodies = waterBodies;
        
        // Fetch water temperature data for the selected site
        const waterTempData = await fetchWaterTemperatureHistoricalData(selectedWaterBody.site_no);
        if (waterTempData) {
            usgsWaterData = {
                site: selectedWaterBody,
                temperature: waterTempData.current
            };
            
            // Update water temperature history
            if (waterTempData.historical && waterTempData.historical.length > 0) {
                waterTemperatureHistory = waterTempData.historical.map(item => ({
                    timestamp: item.time,
                    value: item.value
                }));
                console.log(`Updated water temperature history with ${waterTemperatureHistory.length} historical readings`);
                
                // Update the chart
                updateWaterTemperatureChart();
                
                // Save to storage
                saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
            }
        }
        
        // Update displays
        updateLocationDisplay();
        fetchWeatherData();
        updateWaterTemperatureDisplay();
        await updateNearbyWaterBodiesDisplay();
        updateWaterTempSourceToggleText();
        
        // Recalculate fishing score
        calculateFishingScore();
        
        hideWaterDataLoading();
        
    } catch (error) {
        console.error('Error finding default water body for state:', error);
        hideWaterDataLoading();
        
        const waterBodySelection = document.getElementById('waterBodySelection');
        if (waterBodySelection) {
            waterBodySelection.innerHTML = `
                <div class="no-water-bodies">
                    <div class="no-water-bodies-icon">🌊</div>
                    <div class="no-water-bodies-text">Error loading water bodies</div>
                    <div class="no-water-bodies-subtext">Water temperature will be estimated from air temperature</div>
                </div>
            `;
        }
    }
}

// Location Services
function getLocation() {
    if ('geolocation' in navigator) {
        locationBtn.innerHTML = '<span class="location-icon material-icons">sync</span><span class="location-text">Getting Location...</span>';
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                currentLocation = {
                    lat: position.coords.latitude,
                    lon: position.coords.longitude
                };
                
                // Detect and set the user's state
                const detectedState = detectStateFromCoordinates(position.coords.latitude, position.coords.longitude);
                if (detectedState) {
                    setSelectedState(detectedState);
                }
                
                updateLocationUI();
                fetchWeatherData();
                
                // Find nearest USGS water temperature data
                showWaterDataLoading();
                findNearestUSGSWaterData(position.coords.latitude, position.coords.longitude);
            },
            (error) => {
                console.error('Location error:', error);
                locationBtn.innerHTML = '<span class="location-icon material-icons">location_on</span><span class="location-text">Location Error</span>';
            }
        );
    } else {
        alert('Geolocation is not supported by this browser.');
    }
}

function updateLocationUI() {
    locationBtn.innerHTML = '<span class="location-icon material-icons">location_on</span><span class="location-text">Location Updated</span>';
    setTimeout(() => {
        locationBtn.innerHTML = '<span class="location-icon material-icons">location_on</span><span class="location-text">Get Location</span>';
    }, 2000);
    
    // Update location display
    updateLocationDisplay();
}

async function updateLocationDisplay() {
    if (!currentLocation) return;
    
    try {
        // Get location name using reverse geocoding
        const response = await fetch(
            `${GEOCODING_API_URL}/reverse?lat=${currentLocation.lat}&lon=${currentLocation.lon}&limit=1&appid=${CONFIG.WEATHER_API_KEY}`
        );
        const locationData = await response.json();
        
        if (locationData && locationData.length > 0) {
            const location = locationData[0];
            const name = `${location.name}, ${location.state || location.country}`;
            locationName.textContent = name;
            locationCoords.textContent = `${currentLocation.lat.toFixed(4)}, ${currentLocation.lon.toFixed(4)}`;
            
            // Update current location in storage
            currentLocation.name = name;
            saveToStorage('currentLocation', currentLocation);
        } else {
            locationName.textContent = 'Unknown Location';
            locationCoords.textContent = `${currentLocation.lat.toFixed(4)}, ${currentLocation.lon.toFixed(4)}`;
        }
    } catch (error) {
        console.error('Reverse geocoding error:', error);
        locationName.textContent = 'Unknown Location';
        locationCoords.textContent = `${currentLocation.lat.toFixed(4)}, ${currentLocation.lon.toFixed(4)}`;
    }
}

// Weather API Integration
async function fetchWeatherData() {
    if (!currentLocation) return;
    
    try {
        // Current weather
        const currentWeatherResponse = await fetch(
            `${API_BASE_URL}/weather?lat=${currentLocation.lat}&lon=${currentLocation.lon}&appid=${CONFIG.WEATHER_API_KEY}&units=imperial`
        );
        const currentWeather = await currentWeatherResponse.json();
        
        // Forecast (5 days in 3-hour intervals)
        const forecastResponse = await fetch(
            `${API_BASE_URL}/forecast?lat=${currentLocation.lat}&lon=${currentLocation.lon}&appid=${CONFIG.WEATHER_API_KEY}&units=imperial`
        );
        const forecast = await forecastResponse.json();
        
        weatherData = { current: currentWeather, forecast: forecast };
        updateMoonPhase();
        updateWeatherUI();
        updateForecastUI();
        
        // Process forecast data for trend charts
        processForecastDataForCharts();
        
        calculateFishingScore();
        
    } catch (error) {
        console.error('Weather API error:', error);
        // Use demo data if API fails
        loadDemoData();
    }
}

function loadDemoData() {
    // Demo data for testing without API key - simulate 5 days of 3-hour interval data
    const demoForecastList = [];
    const baseTime = Date.now() / 1000;
    
    for (let i = 0; i < 40; i++) { // 5 days * 8 intervals per day
        const timeOffset = i * 3 * 60 * 60; // 3 hours in seconds
        const dayOffset = Math.floor(i / 8);
        
        // Simulate realistic temperature and pressure variations
        const baseTemp = 72 + Math.sin(i * Math.PI / 8) * 5 + Math.random() * 4 - 2;
        const basePressure = 1013 + Math.sin(i * Math.PI / 16) * 15 + Math.random() * 10 - 5;
        
        demoForecastList.push({
            dt: baseTime + timeOffset,
            main: {
                temp: baseTemp,
                pressure: basePressure,
                humidity: 65 + Math.random() * 20 - 10
            },
            weather: [{ main: i % 12 < 8 ? 'Clear' : (i % 12 < 10 ? 'Clouds' : 'Rain') }]
        });
    }
    
    weatherData = {
        current: {
            main: {
                temp: 72,
                pressure: 1013,
                humidity: 65
            },
            wind: {
                speed: 8.5
            },
            weather: [{
                main: 'Clear',
                description: 'clear sky'
            }]
        },
        forecast: {
            list: demoForecastList
        }
    };
    
    // Set demo location if none exists
    if (!currentLocation) {
        currentLocation = { 
            lat: 41.8781, 
            lon: -87.6298, 
            name: 'Chicago, IL (Demo)' 
        };
        locationName.textContent = currentLocation.name;
        locationCoords.textContent = `${currentLocation.lat.toFixed(4)}, ${currentLocation.lon.toFixed(4)}`;
    }
    
    updateMoonPhase();
    updateWeatherUI();
    updateForecastUI();
    
    // Process forecast data for trend charts
    processForecastDataForCharts();
    
    // Generate demo water temperature historical data
    generateDemoWaterTemperatureHistory();
    
    calculateFishingScore();
    
    // Also try to fetch USGS water temperature data
    fetchUSGSWaterData();
}

// UI Updates
function updateWeatherUI() {
    if (!weatherData) return;
    
    const { current } = weatherData;
    
    document.getElementById('currentTemp').textContent = `${Math.round(current.main.temp)}°F`;
    document.getElementById('pressure').textContent = `${(current.main.pressure * 0.02953).toFixed(2)} inHg`;
    document.getElementById('windSpeed').textContent = `${Math.round(current.wind.speed)} mph`;
    
    // Update water temperature - will use USGS data if available, otherwise estimated
    updateWaterTemperatureDisplay();
}

function updateForecastUI() {
    if (!weatherData) return;
    
    const forecastContainer = document.getElementById('forecastContainer');
    
    // Group forecasts by day to calculate high/low temperatures
    const dailyData = {};
    
    weatherData.forecast.list.forEach(item => {
        const date = new Date(item.dt * 1000);
        const dateKey = date.toDateString(); // "Fri Dec 15 2023" format
        
        if (!dailyData[dateKey]) {
            dailyData[dateKey] = {
                date: date,
                temps: [],
                weatherConditions: [],
                items: []
            };
        }
        
        dailyData[dateKey].temps.push(item.main.temp);
        dailyData[dateKey].weatherConditions.push(item.weather[0]);
        dailyData[dateKey].items.push(item);
    });
    
    // Convert to array and take first 5 days
    const dailyForecasts = Object.values(dailyData).slice(0, 5).map(dayData => {
        const minTemp = Math.min(...dayData.temps);
        const maxTemp = Math.max(...dayData.temps);
        
        // Find the most common weather condition for the day
        const weatherCounts = {};
        dayData.weatherConditions.forEach(weather => {
            const key = weather.main;
            weatherCounts[key] = (weatherCounts[key] || 0) + 1;
        });
        
        const mostCommonWeather = Object.keys(weatherCounts).reduce((a, b) => 
            weatherCounts[a] > weatherCounts[b] ? a : b
        );
        
        return {
            date: dayData.date,
            minTemp: minTemp,
            maxTemp: maxTemp,
            weather: mostCommonWeather,
            dayName: dayData.date.toLocaleDateString('en-US', { weekday: 'short' })
        };
    });
    
    console.log('Daily forecasts with high/low:', dailyForecasts.map(day => ({
        dayName: day.dayName,
        date: day.date.toLocaleDateString(),
        high: Math.round(day.maxTemp),
        low: Math.round(day.minTemp),
        weather: day.weather
    })));
    
    console.log('About to render forecast HTML...');
    
    const forecastHTML = dailyForecasts.map(day => {
        const weatherIcon = getWeatherIcon(day.weather);
        const high = Math.round(day.maxTemp);
        const low = Math.round(day.minTemp);
        
        console.log(`Rendering day: ${day.dayName}, high: ${high}°, low: ${low}°`);
        
        return `
            <div class="forecast-item">
                <div class="forecast-day">${day.dayName}</div>
                <div class="forecast-icon">${weatherIcon}</div>
                <div class="forecast-temps">
                    <div class="forecast-high">${high}°</div>
                    <div class="forecast-low">${low}°</div>
                </div>
            </div>
        `;
    }).join('');
    
    console.log('Final forecast HTML:', forecastHTML);
    forecastContainer.innerHTML = forecastHTML;
}

function getWeatherIcon(weatherType) {
    const icons = {
        'Clear': '☀️',
        'Clouds': '☁️',
        'Rain': '🌧️',
        'Snow': '❄️',
        'Thunderstorm': '⛈️',
        'Drizzle': '🌦️',
        'Mist': '🌫️',
        'Sunny': '☀️',
        'Cloudy': '☁️'
    };
    return icons[weatherType] || '🌤️';
}

function processForecastDataForCharts() {
    if (!weatherData || !weatherData.forecast) return;
    
    // Clear existing data
    pressureHistory = [];
    temperatureHistory = [];
    
    // Process forecast data (5 days in 3-hour intervals)
    const forecastList = weatherData.forecast.list;
    
    console.log('Processing forecast data for charts:', forecastList.length, 'data points');
    
    // For pressure: sample every 6 hours (every 2nd forecast point)
    // For temperature: sample every 6 hours and calculate daily highs/lows
    const dailyTempData = {};
    
    forecastList.forEach((item, index) => {
        const timestamp = new Date(item.dt * 1000);
        const dateKey = timestamp.toDateString();
        
        // Pressure data every 6 hours (every 2nd point)
        if (index % 2 === 0) {
            const pressureInHg = item.main.pressure * 0.02953;
            pressureHistory.push({
                time: timestamp,
                value: pressureInHg
            });
        }
        
        // Collect temperature data by day
        if (!dailyTempData[dateKey]) {
            dailyTempData[dateKey] = {
                date: timestamp,
                temps: [],
                times: []
            };
        }
        
        dailyTempData[dateKey].temps.push(item.main.temp);
        dailyTempData[dateKey].times.push(timestamp);
    });
    
    // Create temperature history with daily high/low averages
    Object.values(dailyTempData).forEach(dayData => {
        const avgTemp = dayData.temps.reduce((a, b) => a + b, 0) / dayData.temps.length;
        const maxTemp = Math.max(...dayData.temps);
        const minTemp = Math.min(...dayData.temps);
        
        // Use average of high and low as the main temperature point
        const dailyTemp = (maxTemp + minTemp) / 2;
        
        // Use the midday time for the day
        const midDayTime = new Date(dayData.date);
        midDayTime.setHours(12, 0, 0, 0);
        
        temperatureHistory.push({
            time: midDayTime,
            value: dailyTemp,
            high: maxTemp,
            low: minTemp
        });
    });
    
    // Sort by time
    pressureHistory.sort((a, b) => a.time - b.time);
    temperatureHistory.sort((a, b) => a.time - b.time);
    
    console.log('Pressure history:', pressureHistory.length, 'points');
    console.log('Temperature history:', temperatureHistory.length, 'points');
    
    // Update charts
    updatePressureChart();
    updateTemperatureChart();
    
    // Save to storage
    saveToStorage('pressureHistory', pressureHistory);
    saveToStorage('temperatureHistory', temperatureHistory);
}

function generateDemoWaterTemperatureHistory() {
    // Generate realistic 5-day water temperature history
    waterTemperatureHistory = [];
    const baseTime = Date.now();
    
    for (let i = 0; i < 5; i++) {
        const dayOffset = i * 24 * 60 * 60 * 1000; // Days in milliseconds
        const timestamp = new Date(baseTime - (4 - i) * 24 * 60 * 60 * 1000); // 5 days ago to today
        
        // Set to noon for each day
        timestamp.setHours(12, 0, 0, 0);
        
        // Generate realistic water temperature (typically 5-10°F cooler than air temp)
        // Base around 65°F with some variation
        const baseWaterTemp = 65 + Math.sin(i * Math.PI / 4) * 3 + Math.random() * 4 - 2;
        
        // Water temperature changes more slowly than air temperature
        // Add some seasonal and daily variation
        const waterTemp = baseWaterTemp + Math.sin(i * Math.PI / 6) * 2;
        
        waterTemperatureHistory.push({
            time: timestamp,
            value: waterTemp,
            temperature_f: waterTemp,
            temperature_c: (waterTemp - 32) * 5 / 9,
            datetime: timestamp.toISOString()
        });
    }
    
    console.log(`Generated ${waterTemperatureHistory.length} demo water temperature readings`);
    
    // Update the chart
    updateWaterTemperatureChart();
    
    // Save to storage
    saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
}

function updatePressureData() {
    // This function is now replaced by processForecastDataForCharts()
    // Keep for backward compatibility but don't use
    if (!weatherData) return;
    
    const pressure = weatherData.current.main.pressure * 0.02953;
    
    // Check if we already have recent data to avoid duplicates
    if (pressureHistory.length > 0) {
        const lastEntry = pressureHistory[pressureHistory.length - 1];
        const timeDiff = new Date() - lastEntry.time;
        if (timeDiff < 2 * 60 * 60 * 1000) { // Less than 2 hours
            return;
        }
    }
    
    pressureHistory.push({
        time: new Date(),
        value: pressure
    });
    
    // Keep only last 5 days
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    pressureHistory = pressureHistory.filter(item => item.time > fiveDaysAgo);
    
    updatePressureChart();
}

function updateTemperatureData() {
    // This function is now replaced by processForecastDataForCharts()
    // Keep for backward compatibility but don't use
    if (!weatherData) return;
    
    const temperature = weatherData.current.main.temp;
    
    // Check if we already have recent data to avoid duplicates
    if (temperatureHistory.length > 0) {
        const lastEntry = temperatureHistory[temperatureHistory.length - 1];
        const timeDiff = new Date() - lastEntry.time;
        if (timeDiff < 2 * 60 * 60 * 1000) { // Less than 2 hours
            return;
        }
    }
    
    temperatureHistory.push({
        time: new Date(),
        value: temperature
    });
    
    // Keep only last 5 days
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    temperatureHistory = temperatureHistory.filter(item => item.time > fiveDaysAgo);
    
    updateTemperatureChart();
}

// Trend Analysis Functions
function calculateTrend(dataArray, hoursToAnalyze = 6) {
    if (!dataArray || dataArray.length < 2) {
        return { trend: 'stable', rate: 0, confidence: 'low' };
    }
    
    // Get recent data points (last N hours)
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - hoursToAnalyze * 60 * 60 * 1000);
    
    // Filter data to recent time window
    const recentData = dataArray.filter(item => {
        const itemTime = new Date(item.timestamp || item.time);
        return itemTime >= cutoffTime;
    }).sort((a, b) => new Date(a.timestamp || a.time) - new Date(b.timestamp || b.time));
    
    if (recentData.length < 2) {
        return { trend: 'stable', rate: 0, confidence: 'low' };
    }
    
    // Calculate linear regression to determine trend
    const n = recentData.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    recentData.forEach((item, index) => {
        const x = index; // Time index
        const y = item.value;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
    });
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const changePerHour = slope * (n / hoursToAnalyze); // Normalize to per-hour change
    
    // Determine trend classification
    const absRate = Math.abs(changePerHour);
    let trend = 'stable';
    let confidence = 'low';
    
    if (absRate > 0.1) {
        trend = changePerHour > 0 ? 'rising' : 'falling';
        confidence = absRate > 0.5 ? 'high' : absRate > 0.2 ? 'medium' : 'low';
    }
    
    return { trend, rate: changePerHour, confidence };
}

function calculatePressureTrend() {
    const trend = calculateTrend(pressureHistory, 6);
    
    // Convert rate to more meaningful pressure units (inHg per hour)
    const pressureRateInHg = trend.rate * 0.02953;
    
    return {
        ...trend,
        rateInHg: pressureRateInHg,
        description: getPressureTrendDescription(trend.trend, pressureRateInHg, trend.confidence)
    };
}

function calculateTemperatureTrend() {
    const trend = calculateTrend(temperatureHistory, 6);
    
    return {
        ...trend,
        description: getTemperatureTrendDescription(trend.trend, trend.rate, trend.confidence)
    };
}

function calculateWaterTemperatureTrend() {
    const trend = calculateTrend(waterTemperatureHistory, 12); // Longer window for water temp
    
    return {
        ...trend,
        description: getWaterTemperatureTrendDescription(trend.trend, trend.rate, trend.confidence)
    };
}

function getPressureTrendDescription(trend, rate, confidence) {
    const absRate = Math.abs(rate);
    
    if (trend === 'falling') {
        if (absRate > 0.05) return 'Rapidly falling (excellent for fishing)';
        if (absRate > 0.02) return 'Falling (very good for fishing)';
        return 'Slowly falling (good for fishing)';
    } else if (trend === 'rising') {
        if (absRate > 0.05) return 'Rapidly rising (poor for fishing)';
        if (absRate > 0.02) return 'Rising (fair for fishing)';
        return 'Slowly rising (fair for fishing)';
    } else {
        return 'Stable (average for fishing)';
    }
}

function getTemperatureTrendDescription(trend, rate, confidence) {
    const absRate = Math.abs(rate);
    
    if (trend === 'rising') {
        if (absRate > 2) return 'Rapidly warming (fish adjusting)';
        if (absRate > 1) return 'Warming (fish becoming active)';
        return 'Slowly warming (stable activity)';
    } else if (trend === 'falling') {
        if (absRate > 2) return 'Rapidly cooling (fish adjusting)';
        if (absRate > 1) return 'Cooling (fish less active)';
        return 'Slowly cooling (stable activity)';
    } else {
        return 'Stable temperature (consistent conditions)';
    }
}

function getWaterTemperatureTrendDescription(trend, rate, confidence) {
    const absRate = Math.abs(rate);
    
    if (trend === 'rising') {
        if (absRate > 1) return 'Warming (fish may seek cooler areas)';
        return 'Slowly warming (fish adapting)';
    } else if (trend === 'falling') {
        if (absRate > 1) return 'Cooling (fish may become less active)';
        return 'Slowly cooling (fish adapting)';
    } else {
        return 'Stable water temperature (consistent habitat)';
    }
}

function calculateFishingScore() {
    if (!weatherData) return;
    
    const { current } = weatherData;
    let score = 0; // Start from 0
    const breakdown = {
        airTemperature: { score: 0, details: '', rating: 'poor' },
        waterTemperature: { score: 0, details: '', rating: 'poor' },
        pressure: { score: 0, details: '', rating: 'poor' },
        wind: { score: 0, details: '', rating: 'poor' },
        weather: { score: 0, details: '', rating: 'poor' },
        moon: { score: 0, details: '', rating: 'poor' }
    };
    
    // Calculate trends for temperature and pressure
    const pressureTrend = calculatePressureTrend();
    const tempTrend = calculateTemperatureTrend();
    const waterTempTrend = calculateWaterTemperatureTrend();
    
    // Debug: Log trend information
    console.log('🌡️ Temperature trend:', tempTrend);
    console.log('💧 Water temperature trend:', waterTempTrend);
    console.log('📊 Pressure trend:', pressureTrend);
    
    // Air Temperature factors (0-15 points, reduced to make room for water temp)
    const airTemp = current.main.temp;
    let airTempScore = 0;
    let airTempDetails = '';
    let airTempRating = 'poor';
    
    // Base score from temperature range
    if (airTemp >= 65 && airTemp <= 75) {
        airTempScore = 15;
        airTempDetails = `${airTemp.toFixed(1)}°F (Ideal comfort range)`;
        airTempRating = 'excellent';
    } else if (airTemp >= 60 && airTemp <= 80) {
        airTempScore = 12;
        airTempDetails = `${airTemp.toFixed(1)}°F (Very comfortable)`;
        airTempRating = 'good';
    } else if (airTemp >= 55 && airTemp <= 85) {
        airTempScore = 8;
        airTempDetails = `${airTemp.toFixed(1)}°F (Good fishing weather)`;
        airTempRating = 'good';
    } else if (airTemp >= 45 && airTemp <= 95) {
        airTempScore = 4;
        airTempDetails = `${airTemp.toFixed(1)}°F (Manageable conditions)`;
        airTempRating = 'fair';
    } else {
        airTempScore = 0;
        airTempDetails = `${airTemp.toFixed(1)}°F (Extreme temperature)`;
        airTempRating = 'poor';
    }
    
    // Apply trend bonus/penalty (+/- 3 points max)
    let trendBonus = 0;
    if (tempTrend.trend === 'stable') {
        trendBonus = 1; // Stable conditions are good
    } else if (tempTrend.trend === 'rising' && airTemp < 70) {
        trendBonus = 2; // Warming up to ideal temps
    } else if (tempTrend.trend === 'falling' && airTemp > 75) {
        trendBonus = 2; // Cooling down from hot temps
    } else if (Math.abs(tempTrend.rate) > 3) {
        trendBonus = -2; // Rapid temperature changes are disruptive
    }
    
    airTempScore = Math.max(0, Math.min(15, airTempScore + trendBonus));
    airTempDetails += ` - ${tempTrend.description}`;
    
    breakdown.airTemperature.score = airTempScore;
    breakdown.airTemperature.details = airTempDetails;
    breakdown.airTemperature.rating = airTempRating;
    score += airTempScore;
    
    // Water Temperature factors (0-20 points, most important for fishing)
    let waterTemp = null;
    let isEstimated = false;
    
    if (usgsWaterData && usgsWaterData.temperature) {
        // Use real USGS water temperature data
        waterTemp = usgsWaterData.temperature.temperature_f;
        isEstimated = false;
    } else {
        // Estimate water temperature from air temperature (typically 5-10°F cooler)
        waterTemp = airTemp - 5;
        isEstimated = true;
    }
    
    let waterTempScore = 0;
    let waterTempDetails = '';
    let waterTempRating = 'poor';
    
    // Base score from temperature range
    if (waterTemp >= 65 && waterTemp <= 75) {
        waterTempScore = 20;
        waterTempDetails = `${waterTemp.toFixed(1)}°F (Excellent range - peak around 70°F)`;
        waterTempRating = 'excellent';
    } else if (waterTemp >= 58 && waterTemp <= 78) {
        waterTempScore = 16;
        waterTempDetails = `${waterTemp.toFixed(1)}°F (Very good for most fish)`;
        waterTempRating = 'good';
    } else if (waterTemp >= 50 && waterTemp <= 85) {
        waterTempScore = 12;
        waterTempDetails = `${waterTemp.toFixed(1)}°F (Good range - fish active)`;
        waterTempRating = 'good';
    } else if (waterTemp >= 45 && waterTemp <= 90) {
        waterTempScore = 6;
        waterTempDetails = `${waterTemp.toFixed(1)}°F (Fair - fish less active)`;
        waterTempRating = 'fair';
    } else if (waterTemp >= 40 && waterTemp <= 95) {
        waterTempScore = 2;
        waterTempDetails = `${waterTemp.toFixed(1)}°F (Poor - fish sluggish)`;
        waterTempRating = 'poor';
    } else {
        waterTempScore = 0;
        waterTempDetails = `${waterTemp.toFixed(1)}°F (Very poor - fish inactive)`;
        waterTempRating = 'poor';
    }
    
    // Apply trend bonus/penalty for water temperature (+/- 4 points max)
    let waterTempTrendBonus = 0;
    if (!isEstimated) {
        // Only apply trend analysis for real water temperature data
        if (waterTempTrend.trend === 'stable') {
            waterTempTrendBonus = 2; // Stable water temp is ideal
        } else if (waterTempTrend.trend === 'rising' && waterTemp < 65) {
            waterTempTrendBonus = 3; // Warming up to ideal range
        } else if (waterTempTrend.trend === 'falling' && waterTemp > 75) {
            waterTempTrendBonus = 3; // Cooling down from hot temps
        } else if (Math.abs(waterTempTrend.rate) > 2) {
            waterTempTrendBonus = -2; // Rapid changes disrupt fish
        }
        
        waterTempScore = Math.max(0, Math.min(20, waterTempScore + waterTempTrendBonus));
        waterTempDetails += ` - ${waterTempTrend.description}`;
    } else {
        waterTempDetails += ' - estimated';
    }
    
    breakdown.waterTemperature.score = waterTempScore;
    breakdown.waterTemperature.details = waterTempDetails;
    breakdown.waterTemperature.rating = waterTempRating;
    score += waterTempScore;
    
    // Pressure factors (0-22 points) - increased max for trend bonuses
    const pressure = current.main.pressure * 0.02953;
    let pressureScore = 0;
    let pressureDetails = '';
    let pressureRating = 'poor';
    
    // Base score from pressure range
    if (pressure >= 30.00 && pressure <= 30.20) {
        pressureScore = 14;
        pressureDetails = `${pressure.toFixed(2)} inHg (Stable range)`;
        pressureRating = 'good';
    } else if (pressure >= 29.90 && pressure <= 30.30) {
        pressureScore = 11;
        pressureDetails = `${pressure.toFixed(2)} inHg (Good stability)`;
        pressureRating = 'good';
    } else if (pressure >= 29.80 && pressure <= 30.40) {
        pressureScore = 8;
        pressureDetails = `${pressure.toFixed(2)} inHg (Moderate pressure)`;
        pressureRating = 'fair';
    } else if (pressure >= 29.50 && pressure <= 30.70) {
        pressureScore = 4;
        pressureDetails = `${pressure.toFixed(2)} inHg (Variable pressure)`;
        pressureRating = 'fair';
    } else {
        pressureScore = 2;
        pressureDetails = `${pressure.toFixed(2)} inHg (Extreme pressure)`;
        pressureRating = 'poor';
    }
    
    // Apply major trend bonuses/penalties for pressure (+/- 8 points max)
    let pressureTrendBonus = 0;
    if (pressureTrend.trend === 'falling') {
        // Falling pressure is excellent for fishing
        const fallRate = Math.abs(pressureTrend.rateInHg);
        if (fallRate > 0.05) {
            pressureTrendBonus = 8; // Rapidly falling - excellent!
            pressureRating = 'excellent';
        } else if (fallRate > 0.02) {
            pressureTrendBonus = 6; // Falling - very good
            pressureRating = 'excellent';
        } else {
            pressureTrendBonus = 4; // Slowly falling - good
            pressureRating = 'good';
        }
    } else if (pressureTrend.trend === 'rising') {
        // Rising pressure is poor for fishing
        const riseRate = Math.abs(pressureTrend.rateInHg);
        if (riseRate > 0.05) {
            pressureTrendBonus = -4; // Rapidly rising - poor
        } else if (riseRate > 0.02) {
            pressureTrendBonus = -2; // Rising - fair
        } else {
            pressureTrendBonus = -1; // Slowly rising - slight negative
        }
    } else {
        // Stable pressure
        pressureTrendBonus = 1; // Stable is better than rising
    }
    
    pressureScore = Math.max(0, Math.min(22, pressureScore + pressureTrendBonus));
    pressureDetails += ` - ${pressureTrend.description}`;
    
    breakdown.pressure.score = pressureScore;
    breakdown.pressure.details = pressureDetails;
    breakdown.pressure.rating = pressureRating;
    score += pressureScore;
    
    // Wind factors (0-17 points)
    const windSpeed = current.wind.speed;
    if (windSpeed >= 8 && windSpeed <= 12) {
        breakdown.wind.score = 17;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Perfect - good surface action)`;
        breakdown.wind.rating = 'excellent';
        score += 17;
    } else if (windSpeed >= 5 && windSpeed <= 15) {
        breakdown.wind.score = 13;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Good - surface movement)`;
        breakdown.wind.rating = 'good';
        score += 13;
    } else if (windSpeed >= 3 && windSpeed <= 20) {
        breakdown.wind.score = 8;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Decent - manageable conditions)`;
        breakdown.wind.rating = 'good';
        score += 8;
    } else if ((windSpeed >= 1 && windSpeed < 3) || (windSpeed > 20 && windSpeed <= 25)) {
        breakdown.wind.score = 4;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (${windSpeed < 3 ? 'Too calm - fish see lines' : 'Strong - tough casting'})`;
        breakdown.wind.rating = 'fair';
        score += 4;
    } else {
        breakdown.wind.score = 0;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (${windSpeed <= 1 ? 'Dead calm - spooky fish' : 'Too windy - unsafe'})`;
        breakdown.wind.rating = 'poor';
    }
    
    // Weather condition factors (0-15 points)
    const weather = current.weather[0].main.toLowerCase();
    if (weather.includes('clear')) {
        breakdown.weather.score = 15;
        breakdown.weather.details = 'Clear skies (Excellent)';
        breakdown.weather.rating = 'excellent';
        score += 15;
    } else if (weather.includes('cloud') && !weather.includes('overcast')) {
        breakdown.weather.score = 12;
        breakdown.weather.details = 'Partly cloudy (Very Good)';
        breakdown.weather.rating = 'good';
        score += 12;
    } else if (weather.includes('overcast') || weather.includes('mist') || weather.includes('fog')) {
        breakdown.weather.score = 8;
        breakdown.weather.details = `${current.weather[0].main} (Good)`;
        breakdown.weather.rating = 'good';
        score += 8;
    } else if (weather.includes('drizzle') || weather.includes('light')) {
        breakdown.weather.score = 4;
        breakdown.weather.details = 'Light precipitation (Fair)';
        breakdown.weather.rating = 'fair';
        score += 4;
    } else if (weather.includes('rain') || weather.includes('snow')) {
        breakdown.weather.score = 2;
        breakdown.weather.details = 'Precipitation (Poor)';
        breakdown.weather.rating = 'poor';
        score += 2;
    } else if (weather.includes('storm') || weather.includes('thunder')) {
        breakdown.weather.score = 0;
        breakdown.weather.details = 'Storm conditions (Very Poor)';
        breakdown.weather.rating = 'poor';
    } else {
        breakdown.weather.score = 8;
        breakdown.weather.details = `${current.weather[0].main} (Good)`;
        breakdown.weather.rating = 'good';
        score += 8;
    }
    
    // Moon phase factors (0-15 points)
    if (window.currentMoonInfo) {
        const moonInfo = window.currentMoonInfo;
        // Scale moon score from 0-20 to 0-15
        const scaledMoonScore = Math.round((moonInfo.score / 20) * 15);
        breakdown.moon.score = scaledMoonScore;
        breakdown.moon.details = `${moonInfo.phase} (${moonInfo.rating === 'excellent' ? 'Excellent' : 'Good'})`;
        breakdown.moon.rating = moonInfo.rating;
        score += scaledMoonScore;
    } else {
        breakdown.moon.score = 0;
        breakdown.moon.details = 'Moon data unavailable';
        breakdown.moon.rating = 'poor';
    }
    
    // Clamp score between 0 and 100
    score = Math.max(0, Math.min(100, score));
    
    // Update UI
    document.getElementById('fishingScore').textContent = score;
    document.getElementById('scoreDescription').textContent = getFishingDescription(score);
    
    // Update score color
    updateScoreColor(score);
    
    // Update individual condition scores in the unified grid
    updateConditionScores(breakdown);
    
    // Update breakdown display
    updateBreakdownContent(breakdown, score);
}

// Update individual condition scores in the unified grid
function updateConditionScores(breakdown) {
    // Helper function to get score class
    const getScoreClass = (rating) => {
        switch (rating) {
            case 'excellent': return 'excellent';
            case 'good': return 'good';
            case 'fair': return 'fair';
            default: return 'poor';
        }
    };
    
    // Update environmental condition scores
    updateScoreElement('tempScore', breakdown.airTemperature.score, breakdown.airTemperature.rating);
    updateScoreElement('waterTempScore', breakdown.waterTemperature.score, breakdown.waterTemperature.rating);
    updateScoreElement('pressureScore', breakdown.pressure.score, breakdown.pressure.rating);
    updateScoreElement('windScore', breakdown.wind.score, breakdown.wind.rating);
    updateScoreElement('moonScore', breakdown.moon.score, breakdown.moon.rating);
    
    // Update trend scores (calculated separately)
    updateTrendScores();
}

function updateScoreElement(elementId, score, rating) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = score;
        element.className = `condition-score ${rating}`;
    }
}

function updateTrendScores() {
    // Calculate and display trend scores
    const pressureTrend = calculatePressureTrend();
    const tempTrend = calculateTemperatureTrend();
    const waterTempTrend = calculateWaterTemperatureTrend();
    
    // Update pressure trend display and score
    const pressureTrendElement = document.getElementById('pressureTrend');
    const pressureTrendScoreElement = document.getElementById('pressureTrendScore');
    if (pressureTrendElement && pressureTrendScoreElement) {
        pressureTrendElement.textContent = pressureTrend.trend === 'falling' ? '↓ Falling' : 
                                         pressureTrend.trend === 'rising' ? '↑ Rising' : '→ Stable';
        
        // Calculate trend score (0-10 scale)
        let trendScore = 5; // Base neutral score
        let trendRating = 'fair';
        
        if (pressureTrend.trend === 'falling') {
            trendScore = Math.min(10, 5 + Math.abs(pressureTrend.rateInHg) * 100);
            trendRating = 'excellent';
        } else if (pressureTrend.trend === 'rising') {
            trendScore = Math.max(0, 5 - Math.abs(pressureTrend.rateInHg) * 50);
            trendRating = 'poor';
        } else {
            trendScore = 6;
            trendRating = 'good';
        }
        
        pressureTrendScoreElement.textContent = Math.round(trendScore);
        pressureTrendScoreElement.className = `condition-score ${trendRating}`;
    }
    
    // Update air temperature trend display and score
    const airTempTrendElement = document.getElementById('airTempTrend');
    const airTempTrendScoreElement = document.getElementById('airTempTrendScore');
    if (airTempTrendElement && airTempTrendScoreElement) {
        airTempTrendElement.textContent = tempTrend.trend === 'rising' ? '↑ Warming' : 
                                        tempTrend.trend === 'falling' ? '↓ Cooling' : '→ Stable';
        
        // Calculate air temp trend score (0-8 scale)
        let tempScore = 4;
        let tempRating = 'fair';
        
        if (tempTrend.trend === 'stable') {
            tempScore = 6;
            tempRating = 'good';
        } else if (Math.abs(tempTrend.rate) < 2) {
            tempScore = 5;
            tempRating = 'good';
        } else {
            tempScore = 2;
            tempRating = 'poor';
        }
        
        airTempTrendScoreElement.textContent = Math.round(tempScore);
        airTempTrendScoreElement.className = `condition-score ${tempRating}`;
    }
    
    // Update water temperature trend display and score
    const waterTempTrendElement = document.getElementById('waterTempTrend');
    const waterTempTrendScoreElement = document.getElementById('waterTempTrendScore');
    if (waterTempTrendElement && waterTempTrendScoreElement) {
        waterTempTrendElement.textContent = waterTempTrend.trend === 'rising' ? '↑ Warming' : 
                                          waterTempTrend.trend === 'falling' ? '↓ Cooling' : '→ Stable';
        
        // Calculate water temp trend score (0-8 scale)
        let waterScore = 4;
        let waterRating = 'fair';
        
        if (waterTempTrend.trend === 'stable') {
            waterScore = 7;
            waterRating = 'excellent';
        } else if (Math.abs(waterTempTrend.rate) < 1) {
            waterScore = 5;
            waterRating = 'good';
        } else {
            waterScore = 2;
            waterRating = 'poor';
        }
        
        waterTempTrendScoreElement.textContent = Math.round(waterScore);
        waterTempTrendScoreElement.className = `condition-score ${waterRating}`;
    }
}

// USGS Water Data API Functions
async function fetchUSGSWaterData() {
    if (!currentLocation) return;
    
    try {
        console.log('Fetching USGS water data...');
        
        // First, find nearby water monitoring sites
        const nearbyWaterSites = await findNearbyWaterSites(currentLocation.lat, currentLocation.lon);
        nearbyWaterBodies = nearbyWaterSites;
        
        // If we have nearby sites, try to get water temperature data
        if (nearbyWaterSites.length > 0) {
            const closestSite = nearbyWaterSites[0];
            const waterTempData = await fetchWaterTemperatureHistoricalData(closestSite.site_no);
            
            if (waterTempData) {
                usgsWaterData = {
                    site: closestSite,
                    temperature: waterTempData.current
                };
                currentWaterBody = closestSite;
                
                // Update water temperature history with historical data
                if (waterTempData.historical && waterTempData.historical.length > 0) {
                    waterTemperatureHistory = waterTempData.historical.map(item => ({
                        timestamp: item.time,
                        value: item.value
                    }));
                    console.log(`Updated water temperature history with ${waterTemperatureHistory.length} historical readings`);
                    
                    // Update the chart
                    updateWaterTemperatureChart();
                    
                    // Save to storage
                    saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
                }
                
                // Update the UI to use USGS data
                updateWaterTemperatureDisplay();
                await updateNearbyWaterBodiesDisplay();
            }
        }
    } catch (error) {
        console.error('USGS Water Data error:', error);
        // Fallback to estimated water temperature
        usgsWaterData = null;
        currentWaterBody = null;
    }
}

async function findNearestUSGSWaterData(lat, lon) {
    try {
        console.log(`Finding nearest USGS water data for location: ${lat}, ${lon}`);
        console.log(`Current state: ${selectedState}, Current water type filter: ${selectedWaterType || 'All'}`);
        
        // Find nearby water monitoring sites
        const nearbyWaterSites = await findNearbyWaterSites(lat, lon);
        
        if (nearbyWaterSites.length === 0) {
            console.log('No nearby USGS sites found for water temperature data');
            return;
        }
        
        console.log(`Found ${nearbyWaterSites.length} nearby USGS sites, trying to get water temperature data`);
        
        // Separate sites into those with water temp and those without
        const waterTempSites = nearbyWaterSites.filter(site => site.has_water_temp);
        const otherSites = nearbyWaterSites.filter(site => !site.has_water_temp);
        
        console.log(`${waterTempSites.length} sites have water temperature sensors, ${otherSites.length} other sites`);
        
        // First, try sites that are known to have water temperature
        for (let i = 0; i < Math.min(5, waterTempSites.length); i++) {
            const site = waterTempSites[i];
            console.log(`Trying water temp site ${i + 1}: ${site.site_name} (${site.distance.toFixed(1)} km away)`);
            
            try {
                const waterTempData = await fetchWaterTemperatureHistoricalData(site.site_no);
                
                if (waterTempData) {
                    console.log(`Successfully got water temperature data from ${site.site_name}: ${waterTempData.current.temperature_f}°F`);
                    
                    // Update global water data
                    usgsWaterData = {
                        site: site,
                        temperature: waterTempData.current
                    };
                    currentWaterBody = site;
                    
                    // Update water temperature history with historical data
                    if (waterTempData.historical && waterTempData.historical.length > 0) {
                        // Transform historical data to match expected format (time -> timestamp)
                        waterTemperatureHistory = waterTempData.historical.map(item => ({
                            timestamp: item.time,
                            value: item.value
                        }));
                        console.log(`Updated water temperature history with ${waterTemperatureHistory.length} historical readings`);
                        
                        // Update the chart
                        updateWaterTemperatureChart();
                        
                        // Save to storage
                        saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
                    }
                    
                    // Update the water temperature display
                    updateWaterTemperatureDisplay();
                    
                    // Update nearby water bodies list to include this site
                    nearbyWaterBodies = nearbyWaterSites;
                    await updateNearbyWaterBodiesDisplay();
                    
                    // Recalculate fishing score with new water temperature data
                    calculateFishingScore();
                    
                    return; // Success, stop trying other sites
                }
            } catch (siteError) {
                console.log(`Failed to get data from ${site.site_name}:`, siteError);
                continue; // Try next site
            }
        }
        
        // If no water temperature data found, try other sites (they might have undocumented temp data)
        console.log('No temperature data from dedicated sites, trying other nearby sites...');
        for (let i = 0; i < Math.min(8, otherSites.length); i++) {
            const site = otherSites[i];
            console.log(`Trying other site ${i + 1}: ${site.site_name} (${site.distance.toFixed(1)} km away, ${site.parameter_type})`);
            
            try {
                const waterTempData = await fetchWaterTemperatureHistoricalData(site.site_no);
                
                if (waterTempData) {
                    console.log(`Unexpectedly found water temperature data from ${site.site_name}: ${waterTempData.current.temperature_f}°F`);
                    
                    // Update global water data
                    usgsWaterData = {
                        site: site,
                        temperature: waterTempData.current
                    };
                    currentWaterBody = site;
                    
                    // Update water temperature history with historical data
                    if (waterTempData.historical && waterTempData.historical.length > 0) {
                        // Transform historical data to match expected format (time -> timestamp)
                        waterTemperatureHistory = waterTempData.historical.map(item => ({
                            timestamp: item.time,
                            value: item.value
                        }));
                        console.log(`Updated water temperature history with ${waterTemperatureHistory.length} historical readings`);
                        
                        // Update the chart
                        updateWaterTemperatureChart();
                        
                        // Save to storage
                        saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
                    }
                    
                    // Update the water temperature display
                    updateWaterTemperatureDisplay();
                    
                    // Update nearby water bodies list to include this site
                    nearbyWaterBodies = nearbyWaterSites;
                    await updateNearbyWaterBodiesDisplay();
                    
                    // Recalculate fishing score with new water temperature data
                    calculateFishingScore();
                    
                    return; // Success, stop trying other sites
                }
            } catch (siteError) {
                console.log(`Failed to get data from ${site.site_name}:`, siteError);
                continue; // Try next site
            }
        }
        
        console.log('No water temperature data available from nearby USGS sites, will use estimated temperature');
        
        // Still update the nearby water bodies list even if no temperature data
        nearbyWaterBodies = nearbyWaterSites;
        await updateNearbyWaterBodiesDisplay();
        
        // Clear loading state and show estimated temperature
        hideWaterDataLoading();
        updateWaterTemperatureDisplay();
        calculateFishingScore();
        
    } catch (error) {
        console.error('Error finding nearest USGS water data:', error);
        // Clear loading state on error
        hideWaterDataLoading();
        updateWaterTemperatureDisplay();
        calculateFishingScore();
    }
}

async function findNearbyWaterSites(lat, lon, radiusKm = 150) {
    try {
        console.log(`Searching for water sites within ${radiusKm}km of ${lat}, ${lon}`);
        console.log(`Water type filter: ${selectedWaterType || 'All'}`);
        
        // Get the primary state and nearby states
        const primaryState = selectedState || detectStateFromCoordinates(lat, lon) || 'NC';
        const nearbyStates = getNearbyStates(lat, lon, primaryState);
        
        console.log(`Primary state: ${primaryState}, also searching: ${nearbyStates.join(', ')}`);
        
        let allSites = [];
        
        // Search multiple states to find water monitoring sites
        for (const stateCd of [primaryState, ...nearbyStates]) {
            console.log(`Searching state: ${stateCd}`);
            
            // Get the appropriate site types based on water type filter
            const getSiteTypes = () => {
                if (selectedWaterType === 'LK') {
                    return 'LK'; // Lakes only
                } else if (selectedWaterType === 'ST') {
                    return 'ST'; // Streams/rivers only
                } else {
                    return 'LK,ST,ES'; // All water bodies (when no filter selected)
                }
            };
            
            const baseSiteTypes = getSiteTypes();
            console.log(`Using site types filter: ${baseSiteTypes} for water type: ${selectedWaterType || 'All'}`);
            
            // Try multiple search strategies for each state
            const searchStrategies = [
                // Water temperature sensors (highest priority)
                { parameterCd: WATER_TEMP_PARAM_CODE_F, siteType: baseSiteTypes, description: 'water temp (F)' },
                { parameterCd: WATER_TEMP_PARAM_CODE, siteType: baseSiteTypes, description: 'water temp (C)' },
                // Only search all sites if no specific water type is selected
                ...(selectedWaterType ? [] : [{ parameterCd: WATER_TEMP_PARAM_CODE_F, siteType: '', description: 'water temp (F) all sites' }]),
                
                // Other water quality parameters that often include temperature
                { parameterCd: '00300,00010,00011', siteType: baseSiteTypes, description: 'water quality params' },
                
                // Streamflow sites (only if we're looking for streams or all)
                ...(selectedWaterType !== 'LK' ? [{ parameterCd: '00060', siteType: 'ST', description: 'streamflow' }] : []),
                
                // Any active water monitoring site of the selected type
                { parameterCd: '', siteType: baseSiteTypes, description: `all ${selectedWaterType === 'LK' ? 'lake' : selectedWaterType === 'ST' ? 'stream' : 'water'} sites` }
            ];
            
            for (const strategy of searchStrategies) {
                try {
                    const apiUrl = `${USGS_IV_API_URL}?format=json&stateCd=${stateCd}${strategy.parameterCd ? '&parameterCd=' + strategy.parameterCd : ''}${strategy.siteType ? '&siteType=' + strategy.siteType : ''}&siteStatus=active`;
                    
                    const response = await fetch(apiUrl);
                    if (!response.ok) continue;
        
        const data = await response.json();
        
                    // Parse response
                    let timeSeries = null;
                    if (data.value && data.value.timeSeries) {
                        timeSeries = data.value.timeSeries;
                    } else if (data.value && data.value.value && data.value.value.timeSeries) {
                        timeSeries = data.value.value.timeSeries;
                    } else if (data.timeSeries) {
                        timeSeries = data.timeSeries;
                    }
                    
                    if (!timeSeries || timeSeries.length === 0) continue;
                    
                    console.log(`Found ${timeSeries.length} sites in ${stateCd} using ${strategy.description}`);
                    
                    // Process sites and filter by distance
                    const sites = timeSeries.map(timeSeriesItem => {
                        const siteInfo = timeSeriesItem.sourceInfo;
            const siteLatLon = siteInfo.geoLocation.geogLocation;
            const distance = calculateDistance(lat, lon, parseFloat(siteLatLon.latitude), parseFloat(siteLatLon.longitude));
            
            return {
                site_no: siteInfo.siteCode[0].value,
                site_name: siteInfo.siteName,
                latitude: parseFloat(siteLatLon.latitude),
                longitude: parseFloat(siteLatLon.longitude),
                distance: distance,
                site_type: siteInfo.siteProperty.find(prop => prop.name === 'siteTypeCd')?.value || 'Unknown',
                            has_water_temp: strategy.parameterCd.includes('00010') || strategy.parameterCd.includes('00011'),
                            parameter_type: strategy.description,
                            state: stateCd
                        };
                    }).filter(site => site.distance <= radiusKm); // Filter by radius
                    
                    allSites.push(...sites);
                    
                    // If we found water temperature sites, prioritize this strategy
                    if (sites.length > 0 && strategy.description.includes('water temp')) {
                        console.log(`Found ${sites.length} water temperature sites in ${stateCd}, prioritizing these`);
                        break; // Move to next state
                    }
                    
                } catch (strategyError) {
                    console.log(`Error with strategy ${strategy.description} in ${stateCd}:`, strategyError);
                    continue;
                }
            }
        }
        
        // Remove duplicates based on site_no
        const uniqueSites = allSites.filter((site, index, self) => 
            index === self.findIndex(s => s.site_no === site.site_no)
        );
        
        // Apply final water type filter to ensure only correct types are returned
        let filteredSites = uniqueSites;
        if (selectedWaterType) {
            filteredSites = uniqueSites.filter(site => {
                if (selectedWaterType === 'LK') {
                    return site.site_type === 'LK';
                } else if (selectedWaterType === 'ST') {
                    return site.site_type === 'ST';
                }
                return true; // If selectedWaterType is somehow invalid, include all
            });
            
            console.log(`Found ${uniqueSites.length} unique sites total, ${filteredSites.length} matching water type filter (${selectedWaterType})`);
        } else {
            console.log(`Found ${uniqueSites.length} unique sites total within ${radiusKm}km (no water type filter)`);
        }
        
        // Sort by distance and prioritize water temperature sites
        const sortedSites = filteredSites.sort((a, b) => {
            // Prioritize water temperature sites
            if (a.has_water_temp && !b.has_water_temp) return -1;
            if (!a.has_water_temp && b.has_water_temp) return 1;
            // Then sort by distance
            return a.distance - b.distance;
        });
        
        // Return top 20 sites
        const finalSites = sortedSites.slice(0, 20);
        
        if (finalSites.length > 0) {
            console.log(`Returning ${finalSites.length} filtered sites:`);
            finalSites.forEach((site, index) => {
                console.log(`  ${index + 1}. ${site.site_name} (${site.site_type}) - ${site.distance.toFixed(1)}km`);
            });
        }
        
        return finalSites;
        
    } catch (error) {
        console.error('Error finding nearby water sites:', error);
        return [];
    }
}

function getNearbyStates(lat, lon, primaryState) {
    // Define neighboring states for major states
    const stateNeighbors = {
        'NC': ['SC', 'VA', 'TN', 'GA'],
        'SC': ['NC', 'GA'],
        'VA': ['NC', 'WV', 'MD', 'TN'],
        'TN': ['NC', 'VA', 'KY', 'GA', 'AL', 'MS', 'AR', 'MO'],
        'GA': ['NC', 'SC', 'TN', 'AL', 'FL'],
        'FL': ['GA', 'AL'],
        'CA': ['NV', 'AZ', 'OR'],
        'TX': ['OK', 'AR', 'LA', 'NM'],
        'NY': ['PA', 'NJ', 'CT', 'MA', 'VT'],
        'PA': ['NY', 'NJ', 'DE', 'MD', 'WV', 'OH'],
        'OH': ['PA', 'WV', 'KY', 'IN', 'MI'],
        'MI': ['OH', 'IN', 'WI'],
        'IL': ['IN', 'WI', 'IA', 'MO'],
        'WI': ['MI', 'IL', 'IA', 'MN'],
        'MN': ['WI', 'IA', 'SD', 'ND'],
        'WA': ['OR', 'ID'],
        'OR': ['WA', 'CA', 'NV', 'ID'],
        'CO': ['NM', 'AZ', 'UT', 'WY', 'NE', 'KS', 'OK'],
        'AZ': ['CA', 'NV', 'UT', 'CO', 'NM'],
        'NV': ['CA', 'AZ', 'UT', 'ID', 'OR'],
        'UT': ['NV', 'AZ', 'CO', 'WY', 'ID'],
        'ID': ['WA', 'OR', 'NV', 'UT', 'WY', 'MT'],
        'MT': ['ID', 'WY', 'ND', 'SD'],
        'WY': ['MT', 'ID', 'UT', 'CO', 'NE', 'SD'],
        'ND': ['MT', 'SD', 'MN'],
        'SD': ['ND', 'MT', 'WY', 'NE', 'IA', 'MN'],
        'NE': ['SD', 'WY', 'CO', 'KS', 'IA', 'MO'],
        'KS': ['NE', 'CO', 'OK', 'MO'],
        'OK': ['KS', 'CO', 'NM', 'TX', 'AR', 'MO'],
        'AR': ['MO', 'OK', 'TX', 'LA', 'MS', 'TN'],
        'LA': ['AR', 'TX', 'MS'],
        'MS': ['LA', 'AR', 'TN', 'AL'],
        'AL': ['MS', 'TN', 'GA', 'FL'],
        'KY': ['OH', 'WV', 'VA', 'TN', 'MO', 'IL', 'IN'],
        'WV': ['PA', 'MD', 'VA', 'KY', 'OH'],
        'MD': ['PA', 'WV', 'VA', 'DE'],
        'DE': ['PA', 'MD', 'NJ'],
        'NJ': ['NY', 'PA', 'DE'],
        'CT': ['NY', 'MA', 'RI'],
        'RI': ['CT', 'MA'],
        'MA': ['NY', 'VT', 'NH', 'CT', 'RI'],
        'VT': ['NY', 'NH', 'MA'],
        'NH': ['VT', 'MA', 'ME'],
        'ME': ['NH'],
        'IN': ['OH', 'KY', 'IL', 'MI'],
        'IA': ['MN', 'WI', 'IL', 'MO', 'NE', 'SD'],
        'MO': ['IA', 'IL', 'KY', 'TN', 'AR', 'OK', 'KS', 'NE']
    };
    
    // Get neighbors for the primary state, or return empty array if not found
    return stateNeighbors[primaryState] || [];
}

async function fetchWaterTemperatureHistoricalData(siteNo) {
    try {
        // Try multiple parameter codes for water temperature
        const tempParameters = [
            { code: WATER_TEMP_PARAM_CODE_F, name: 'Water temperature (°F)', unit: 'F' },
            { code: WATER_TEMP_PARAM_CODE, name: 'Water temperature (°C)', unit: 'C' },
            { code: '00020', name: 'Air temperature (°C)', unit: 'C' }, // Sometimes used for water temp
            { code: '00021', name: 'Air temperature (°F)', unit: 'F' }  // Sometimes used for water temp
        ];
        
        for (const param of tempParameters) {
            try {
                // Fetch 5 days of historical data
                const response = await fetch(
                    `${USGS_IV_API_URL}?format=json&sites=${siteNo}&parameterCd=${param.code}&period=P5D`
                );
                
                if (!response.ok) {
                    continue; // Try next parameter
                }
                
                const data = await response.json();
                
                // Handle different USGS response structures
                let timeSeriesArray = null;
                if (data.value && data.value.timeSeries) {
                    timeSeriesArray = data.value.timeSeries;
                } else if (data.value && data.value.value && data.value.value.timeSeries) {
                    timeSeriesArray = data.value.value.timeSeries;
                } else if (data.timeSeries) {
                    timeSeriesArray = data.timeSeries;
                }
                
                if (!timeSeriesArray || timeSeriesArray.length === 0) {
                    continue; // Try next parameter
                }
                
                const timeSeries = timeSeriesArray[0];
                const values = timeSeries.values[0].value;
                
                if (values.length === 0) {
                    continue; // Try next parameter
                }
                
                console.log(`Found ${values.length} historical temperature readings using ${param.name}`);
                
                // Process all values to create historical data
                const historicalData = [];
                const dailyReadings = new Map(); // Group by day
                
                // First, group all readings by day
                for (const reading of values) {
                    const tempValue = parseFloat(reading.value);
                    
                    // Convert to Fahrenheit if needed
                    let tempF, tempC;
                    if (param.unit === 'F') {
                        tempF = tempValue;
                        tempC = (tempValue - 32) * 5 / 9;
                    } else {
                        tempC = tempValue;
                        tempF = (tempValue * 9 / 5) + 32;
                    }
                    
                    // Sanity check: water temperature should be between -5°C and 50°C (23°F to 122°F)
                    if (tempC < -5 || tempC > 50) {
                        continue; // Skip unrealistic values
                    }
                    
                    const timestamp = new Date(reading.dateTime);
                    const dayKey = timestamp.toDateString();
                    
                    if (!dailyReadings.has(dayKey)) {
                        dailyReadings.set(dayKey, []);
                    }
                    
                    dailyReadings.get(dayKey).push({
                        time: timestamp,
                        value: tempF,
                        temperature_f: tempF,
                        temperature_c: tempC,
                        datetime: reading.dateTime
                    });
                }
                
                // Now select 2-3 representative readings from each day (morning, afternoon, evening)
                for (const [dayKey, dayReadings] of dailyReadings) {
                    if (dayReadings.length === 0) continue;
                    
                    // Sort readings by time for this day
                    dayReadings.sort((a, b) => a.time - b.time);
                    
                    if (dayReadings.length === 1) {
                        // Only one reading for this day
                        historicalData.push(dayReadings[0]);
                    } else if (dayReadings.length <= 3) {
                        // Few readings, take all
                        historicalData.push(...dayReadings);
                    } else {
                        // Multiple readings, take 2-3 representative ones
                        const indices = [
                            0, // First reading (morning)
                            Math.floor(dayReadings.length / 2), // Middle (afternoon)
                            dayReadings.length - 1 // Last reading (evening)
                        ];
                        
                        indices.forEach(index => {
                            if (dayReadings[index]) {
                                historicalData.push(dayReadings[index]);
                            }
                        });
                    }
                }
                
                // Sort by time
                historicalData.sort((a, b) => a.time - b.time);
                
                if (historicalData.length > 0) {
                    console.log(`Processed ${historicalData.length} historical water temperature readings`);
                    
                    // Get the most recent value for current display
                    const recentValue = values[values.length - 1];
                    const recentTempValue = parseFloat(recentValue.value);
                    
                    let recentTempF, recentTempC;
                    if (param.unit === 'F') {
                        recentTempF = recentTempValue;
                        recentTempC = (recentTempValue - 32) * 5 / 9;
                    } else {
                        recentTempC = recentTempValue;
                        recentTempF = (recentTempValue * 9 / 5) + 32;
                    }
                    
                    return {
                        current: {
                            temperature_f: recentTempF,
                            temperature_c: recentTempC,
                            datetime: recentValue.dateTime,
                            site_no: siteNo,
                            unit: timeSeries.variable.unit.unitDescription,
                            parameter_code: param.code,
                            parameter_name: param.name
                        },
                        historical: historicalData
                    };
                }
                
            } catch (paramError) {
                console.log(`Error trying parameter ${param.code}:`, paramError);
                continue; // Try next parameter
            }
        }
        
        return null; // No temperature data found with any parameter
        
    } catch (error) {
        console.error('Error fetching historical water temperature data:', error);
        return null;
    }
}

async function fetchWaterTemperatureData(siteNo) {
    try {
        // Try multiple parameter codes for water temperature
        const tempParameters = [
            { code: WATER_TEMP_PARAM_CODE_F, name: 'Water temperature (°F)', unit: 'F' },
            { code: WATER_TEMP_PARAM_CODE, name: 'Water temperature (°C)', unit: 'C' },
            { code: '00020', name: 'Air temperature (°C)', unit: 'C' }, // Sometimes used for water temp
            { code: '00021', name: 'Air temperature (°F)', unit: 'F' }  // Sometimes used for water temp
        ];
        
        for (const param of tempParameters) {
            try {
                const response = await fetch(
                    `${USGS_IV_API_URL}?format=json&sites=${siteNo}&parameterCd=${param.code}&period=P1D`
                );
                
                if (!response.ok) {
                    continue; // Try next parameter
                }
                
                const data = await response.json();
                
                // Handle different USGS response structures
                let timeSeriesArray = null;
                if (data.value && data.value.timeSeries) {
                    timeSeriesArray = data.value.timeSeries;
                } else if (data.value && data.value.value && data.value.value.timeSeries) {
                    timeSeriesArray = data.value.value.timeSeries;
                } else if (data.timeSeries) {
                    timeSeriesArray = data.timeSeries;
                }
                
                if (!timeSeriesArray || timeSeriesArray.length === 0) {
                    continue; // Try next parameter
                }
                
                const timeSeries = timeSeriesArray[0];
                const values = timeSeries.values[0].value;
                
                if (values.length === 0) {
                    continue; // Try next parameter
                }
                
                // Get the most recent value
                const recentValue = values[values.length - 1];
                const tempValue = parseFloat(recentValue.value);
                
                // Convert to Fahrenheit if needed
                let tempF, tempC;
                if (param.unit === 'F') {
                    tempF = tempValue;
                    tempC = (tempValue - 32) * 5 / 9;
                } else {
                    tempC = tempValue;
                    tempF = (tempValue * 9 / 5) + 32;
                }
                
                // Sanity check: water temperature should be between -5°C and 50°C (23°F to 122°F)
                if (tempC < -5 || tempC > 50) {
                    console.log(`Temperature ${tempC}°C seems unrealistic for water, trying next parameter`);
                    continue;
                }
                
                console.log(`Found temperature data using ${param.name}: ${tempF.toFixed(1)}°F`);
                
                return {
                    temperature_f: tempF,
                    temperature_c: tempC,
                    datetime: recentValue.dateTime,
                    site_no: siteNo,
                    unit: timeSeries.variable.unit.unitDescription,
                    parameter_code: param.code,
                    parameter_name: param.name
                };
                
            } catch (paramError) {
                console.log(`Error trying parameter ${param.code}:`, paramError);
                continue; // Try next parameter
            }
        }
        
        return null; // No temperature data found with any parameter
        
    } catch (error) {
        console.error('Error fetching water temperature data:', error);
        return null;
    }
}

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function getFishingDescription(score) {
    // Define bite description words for different score ranges
    const biteDescriptions = {
        exceptional: [
            'absolutely legendary', 'insanely hot', 'completely bonkers', 'off the charts', 
            'absolutely electric', 'totally insane', 'completely mental', 'absolutely wicked',
            'ridiculously hot', 'completely nuts', 'absolutely bananas', 'totally lit'
        ],
        excellent: [
            'absolutely stellar', 'incredibly hot', 'super active', 'really cooking', 
            'totally dialed in', 'completely locked in', 'absolutely crushing', 'really cranking',
            'super charged', 'totally fired up', 'absolutely pumping', 'really rolling'
        ],
        good: [
            'pretty solid', 'fairly active', 'quite decent', 'reasonably good', 
            'looking promising', 'holding steady', 'pretty consistent', 'fairly reliable',
            'quite encouraging', 'reasonably active', 'pretty hopeful', 'fairly positive'
        ],
        fair: [
            'somewhat mixed', 'kinda spotty', 'pretty hit or miss', 'a bit unpredictable',
            'sorta iffy', 'somewhat inconsistent', 'kinda up and down', 'a bit scattered',
            'pretty variable', 'somewhat temperamental', 'kinda moody', 'a bit finicky'
        ],
        poor: [
            'pretty slow', 'quite tough', 'rather challenging', 'pretty sluggish',
            'quite difficult', 'pretty stubborn', 'rather uncooperative', 'quite picky',
            'pretty finicky', 'rather selective', 'quite hesitant', 'pretty reluctant'
        ],
        verypoor: [
            'really tough', 'extremely challenging', 'pretty brutal', 'quite miserable',
            'really stubborn', 'extremely difficult', 'pretty unforgiving', 'quite punishing',
            'really harsh', 'extremely tough', 'pretty merciless', 'quite ruthless'
        ],
        terrible: [
            'absolutely brutal', 'completely dead', 'totally lifeless', 'utterly hopeless',
            'completely shut down', 'absolutely terrible', 'totally awful', 'completely dreadful',
            'absolutely miserable', 'totally dismal', 'completely pathetic', 'utterly depressing'
        ]
    };
    
    let descriptions;
    if (score >= 85) {
        descriptions = biteDescriptions.exceptional;
    } else if (score >= 70) {
        descriptions = biteDescriptions.excellent;
    } else if (score >= 55) {
        descriptions = biteDescriptions.good;
    } else if (score >= 40) {
        descriptions = biteDescriptions.fair;
    } else if (score >= 25) {
        descriptions = biteDescriptions.poor;
    } else if (score >= 10) {
        descriptions = biteDescriptions.verypoor;
    } else {
        descriptions = biteDescriptions.terrible;
    }
    
    // Randomly select a description from the appropriate array
    const randomIndex = Math.floor(Math.random() * descriptions.length);
    const selectedDescription = descriptions[randomIndex];
    
    return `The bite is ${selectedDescription}`;
}

function updateScoreColor(score) {
    const scoreContainer = document.getElementById('fishingScoreContainer');
    
    // Calculate dynamic gradient colors based on score
    const colors = getScoreGradientColors(score);
    
    // Apply the gradient background
    scoreContainer.style.background = `linear-gradient(135deg, ${colors.primary}, ${colors.secondary})`;
}

function getScoreGradientColors(score) {
    // Clamp score between 0 and 100
    const clampedScore = Math.max(0, Math.min(100, score));
    
    // Convert score to hue (0-100 -> 0-120 degrees)
    // 0 = red, 60 = yellow, 120 = green
    const hue = (clampedScore / 100) * 120;
    
    // Calculate saturation and lightness for vibrant colors
    const saturation = 75; // Keep colors vibrant
    const lightness = 50;  // Medium lightness for good contrast
    
    // Create primary color
    const primaryHsl = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    
    // Create secondary color (slightly darker and more saturated for gradient effect)
    const secondaryHue = Math.max(0, hue - 10); // Slightly shift hue
    const secondaryLightness = Math.max(30, lightness - 15); // Darker
    const secondarySaturation = Math.min(85, saturation + 10); // More saturated
    const secondaryHsl = `hsl(${secondaryHue}, ${secondarySaturation}%, ${secondaryLightness}%)`;
    
    return {
        primary: primaryHsl,
        secondary: secondaryHsl
    };
}

// USGS UI Update Functions
function updateWaterTemperatureDisplay() {
    const waterTempElement = document.getElementById('waterTemp');
    
    console.log('updateWaterTemperatureDisplay called');
    console.log('usgsWaterData:', usgsWaterData);
    console.log('isWaterDataLoading:', isWaterDataLoading);
    
    if (usgsWaterData && usgsWaterData.temperature) {
        const temp = usgsWaterData.temperature;
        const tempText = `${Math.round(temp.temperature_f)}°F`;
        const dateTime = new Date(temp.datetime);
        const timeAgo = getTimeAgo(dateTime);
        const distance = usgsWaterData.site.distance;
        
        waterTempElement.textContent = tempText;
        
        if (temp.estimated) {
            // This is estimated temperature
            const estimationDetails = temp.estimation_details;
            let tooltipText = `Estimated from 5-day average air temperature`;
            if (estimationDetails) {
                tooltipText += ` (avg: ${estimationDetails.avg_air_temp_f.toFixed(1)}°F, seasonal offset: ${estimationDetails.seasonal_offset}°F)`;
            }
            tooltipText += ` - ${usgsWaterData.site.site_name}`;
            if (distance && distance > 0) {
                tooltipText += ` (${distance.toFixed(1)} km away)`;
            }
            waterTempElement.title = tooltipText;
            
            // Style for estimated temperature
            waterTempElement.style.color = '#f59e0b'; // Amber/orange for estimated
            waterTempElement.style.fontWeight = 'bold';
            waterTempElement.classList.remove('loading-pulse');
            
            console.log(`Water temperature estimated: ${tempText} for ${usgsWaterData.site.site_name}${distance > 0 ? ` (${distance.toFixed(1)} km away)` : ''}`);
        } else {
            // This is real USGS data
            let tooltipText = `From ${usgsWaterData.site.site_name} - ${timeAgo}`;
            if (distance && distance > 0) {
                tooltipText += ` (${distance.toFixed(1)} km away)`;
            }
            waterTempElement.title = tooltipText;
            
            // Style for real USGS data
            waterTempElement.style.color = '#10b981'; // Green for real data
            waterTempElement.style.fontWeight = 'bold';
            waterTempElement.classList.remove('loading-pulse');
            
            // Update water temperature history
            updateWaterTemperatureHistory(temp.temperature_f);
            
            console.log(`Water temperature updated: ${tempText} from ${usgsWaterData.site.site_name}${distance > 0 ? ` (${distance.toFixed(1)} km away)` : ''}`);
        }
        
        // Clear loading state
        hideWaterDataLoading();
    } else if (weatherData && !isWaterDataLoading) {
        // Only show estimated temperature if we're not currently loading USGS data
        const estimatedTemp = Math.round(weatherData.current.main.temp - 5);
        waterTempElement.textContent = `${estimatedTemp}°F`;
        waterTempElement.title = 'Estimated from air temperature (no nearby water temperature sensors found)';
        waterTempElement.style.color = '#64748b';
        waterTempElement.style.fontWeight = 'normal';
        waterTempElement.classList.remove('loading-pulse');
        
        // Update water temperature history with estimated value
        updateWaterTemperatureHistory(estimatedTemp);
        
        console.log(`Water temperature estimated: ${estimatedTemp}°F (no USGS data available)`);
    }
    
    // Update the water temperature source toggle button text
    updateWaterTempSourceToggleText();
}

// Update the water temperature source toggle button text
function updateWaterTempSourceToggleText() {
    const toggleTextElement = document.querySelector('.water-temp-toggle .toggle-text');
    
    if (currentWaterBody && currentWaterBody.site_name) {
        // Show the current source name (truncated if too long)
        const siteName = currentWaterBody.site_name;
        const shortName = siteName.length > 25 ? siteName.substring(0, 25) + '...' : siteName;
        toggleTextElement.textContent = shortName;
        toggleTextElement.title = siteName; // Full name in tooltip
    } else {
        // Show default text when no specific source is selected
        toggleTextElement.textContent = 'Water Temperature Data Source';
        toggleTextElement.title = 'Select a water temperature data source';
    }
}

async function updateNearbyWaterBodiesDisplay() {
    const waterBodySelection = document.getElementById('waterBodySelection');
    const mapContainer = document.querySelector('.map-container');
    
    if (nearbyWaterBodies.length > 0) {
        // Check water temperature data availability for each site
        const sitesWithTempStatus = await Promise.all(
            nearbyWaterBodies.slice(0, 3).map(async (site) => {
                // Check if we already know the temperature data status
                if (site.hasWaterTempData === undefined) {
                    // Quick check for water temperature data availability
                    try {
                        const tempData = await fetchWaterTemperatureData(site.site_no);
                        site.hasWaterTempData = tempData !== null;
                    } catch (error) {
                        site.hasWaterTempData = false;
                    }
                }
                return site;
            })
        );
        
        const waterBodiesHTML = `
            <div class="water-bodies-list">
                <h3>Water Temperature Data Source</h3>
                ${sitesWithTempStatus.map(site => {
                    const distance = site.distance.toFixed(1);
                    const isActive = currentWaterBody && currentWaterBody.site_no === site.site_no;
                    const hasWaterTempData = site.hasWaterTempData;
                    const tempDataIcon = hasWaterTempData 
                        ? '<span class="material-icons temp-data-icon available" title="Real water temperature data available">sensors</span>' 
                        : '<span class="material-icons temp-data-icon unavailable" title="No water temperature data - will estimate from air temperature">sensors_off</span>';
                    const tempDataText = hasWaterTempData ? 'Real water temp data' : 'Estimated water temp';
                    
                    return `
                        <div class="water-body-item ${isActive ? 'active' : ''} ${hasWaterTempData ? 'has-temp-data' : 'no-temp-data'}" 
                             data-site-no="${site.site_no}" 
                             data-lat="${site.latitude}" 
                             data-lon="${site.longitude}"
                             data-name="${site.site_name}"
                             data-has-temp-data="${hasWaterTempData}">
                            <div class="water-body-info">
                                <div class="water-body-name">
                                    ${tempDataIcon}
                                    ${site.site_name}
                                </div>
                                <div class="water-body-details">
                                    ${site.site_type} • ${distance} km away • ${tempDataText}
                                    ${isActive ? ' • <span class="active-indicator">Current Source</span>' : ''}
                                </div>
                            </div>
                            <div class="water-body-actions">
                                <button class="select-water-body-btn" data-site-no="${site.site_no}">
                                    ${isActive ? 'Active' : 'Use This'}
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        waterBodySelection.innerHTML = waterBodiesHTML;
        
        // Clear the map container and show a simple map placeholder
        mapContainer.innerHTML = `
            <div class="map-placeholder">
                <div class="map-icon">🗺️</div>
                <div class="map-text">Interactive map coming soon</div>
                <div class="map-subtext">Currently showing nearest USGS monitoring stations above</div>
            </div>
        `;
        
        // Add click handlers for water body selection
        const selectButtons = waterBodySelection.querySelectorAll('.select-water-body-btn');
        selectButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                console.log('Water body button clicked');
                const siteNo = e.target.dataset.siteNo;
                console.log('Site number:', siteNo, 'Type:', typeof siteNo);
                console.log('Available sites:', nearbyWaterBodies.map(s => ({ site_no: s.site_no, type: typeof s.site_no })));
                let site = nearbyWaterBodies.find(s => s.site_no === siteNo);
                
                // If not found with exact match, try with string conversion
                if (!site) {
                    site = nearbyWaterBodies.find(s => String(s.site_no) === String(siteNo));
                }
                
                // If still not found, try with number conversion
                if (!site) {
                    site = nearbyWaterBodies.find(s => Number(s.site_no) === Number(siteNo));
                }
                
                console.log('Found site:', site);
                
                if (site) {
                    console.log('Processing site selection...');
                    // Update current location to this water body
                    currentWaterBody = site;
                    
                    // Show loading indicators
                    showWaterDataLoading();
                    
                    // Check if this site has water temperature data
                    const hasWaterTempData = site.hasWaterTempData;
                    console.log('Site has water temp data:', hasWaterTempData);
                    
                    try {
                        if (hasWaterTempData) {
                            // Fetch real water temperature data for this site
                            const waterTempData = await fetchWaterTemperatureHistoricalData(site.site_no);
                            
                            if (waterTempData) {
                                usgsWaterData = {
                                    site: site,
                                    temperature: waterTempData.current
                                };
                                isUsingEstimatedWaterTemp = false;
                                
                                // Update water temperature history with historical data
                                if (waterTempData.historical && waterTempData.historical.length > 0) {
                                    // Transform historical data to match expected format (time -> timestamp)
                                    waterTemperatureHistory = waterTempData.historical.map(item => ({
                                        timestamp: item.time,
                                        value: item.value
                                    }));
                                    console.log(`Updated water temperature history with ${waterTemperatureHistory.length} historical readings`);
                                    
                                    // Update the chart
                                    updateWaterTemperatureChart();
                                    
                                    // Save to storage
                                    saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
                                }
                            } else {
                                // Failed to get data, fall back to estimation
                                useEstimatedWaterTemperature(site);
                            }
                        } else {
                            // No water temperature data available, use estimation
                            useEstimatedWaterTemperature(site);
                        }
                        
                        // Update displays
                        hideWaterDataLoading();
                        updateWaterTemperatureDisplay();
                        await updateNearbyWaterBodiesDisplay();
                        calculateFishingScore();
                        console.log('Site selection completed');
                    } catch (error) {
                        console.error('Error processing site selection:', error);
                        hideWaterDataLoading();
                    }
                } else {
                    console.error('Site not found for siteNo:', siteNo);
                }
            });
        });
        
        // Add click handlers for water body items
        const waterBodyItems = waterBodySelection.querySelectorAll('.water-body-item');
        waterBodyItems.forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('select-water-body-btn')) return;
                
                const lat = parseFloat(item.dataset.lat);
                const lon = parseFloat(item.dataset.lon);
                const name = item.dataset.name;
                
                // Update current location to this water body
                currentLocation = { lat, lon, name };
                updateLocationDisplay();
            });
        });
    } else {
        waterBodySelection.innerHTML = `
            <div class="no-water-bodies">
                <div class="no-water-bodies-icon">🌊</div>
                <div class="no-water-bodies-text">No USGS monitoring sites found nearby</div>
                <div class="no-water-bodies-subtext">Water temperature will be estimated from air temperature</div>
            </div>
        `;
        
        // Clear the map container and show a simple map placeholder
        mapContainer.innerHTML = `
            <div class="map-placeholder">
                <div class="map-icon">🗺️</div>
                <div class="map-text">Interactive map coming soon</div>
                <div class="map-subtext">No nearby monitoring stations to display</div>
            </div>
        `;
    }
    
    // Update the toggle button text to reflect current state
    updateWaterTempSourceToggleText();
}

function getTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
        return 'just now';
    } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600);
        return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
        const days = Math.floor(diffInSeconds / 86400);
        return `${days} day${days > 1 ? 's' : ''} ago`;
    }
}

// Moon Phase Functions
function calculateMoonPhase() {
    const today = new Date();
    const knownNewMoon = new Date('2024-01-11'); // Known new moon date
    const daysSinceNewMoon = Math.floor((today - knownNewMoon) / (1000 * 60 * 60 * 24));
    const lunarCycle = 29.53059; // Average lunar cycle in days
    const currentCycle = ((daysSinceNewMoon % lunarCycle) + lunarCycle) % lunarCycle;
    
    return currentCycle;
}

function getMoonPhaseInfo(moonAge) {
    if (moonAge < 1.84566) {
        return { phase: 'New Moon', icon: '🌑', score: 20, rating: 'excellent' };
    } else if (moonAge < 5.53699) {
        return { phase: 'Waxing Crescent', icon: '🌒', score: 10, rating: 'good' };
    } else if (moonAge < 9.22831) {
        return { phase: 'First Quarter', icon: '🌓', score: 15, rating: 'good' };
    } else if (moonAge < 12.91963) {
        return { phase: 'Waxing Gibbous', icon: '🌔', score: 10, rating: 'good' };
    } else if (moonAge < 16.61096) {
        return { phase: 'Full Moon', icon: '🌕', score: 20, rating: 'excellent' };
    } else if (moonAge < 20.30228) {
        return { phase: 'Waning Gibbous', icon: '🌖', score: 10, rating: 'good' };
    } else if (moonAge < 23.99361) {
        return { phase: 'Last Quarter', icon: '🌗', score: 15, rating: 'good' };
    } else if (moonAge < 27.68493) {
        return { phase: 'Waning Crescent', icon: '🌘', score: 10, rating: 'good' };
    } else {
        return { phase: 'New Moon', icon: '🌑', score: 20, rating: 'excellent' };
    }
}

function updateMoonPhase() {
    const moonAge = calculateMoonPhase();
    const moonInfo = getMoonPhaseInfo(moonAge);
    
    moonPhaseElement.textContent = moonInfo.phase;
    moonIconElement.textContent = moonInfo.icon;
    
    // Store moon info for fishing score calculation
    window.currentMoonInfo = moonInfo;
}

// Chart Functions
function initializeCharts() {
    // Initialize with empty charts
    updatePressureChart();
    updateTemperatureChart();
    updateWaterTemperatureChart();
}

function updatePressureChart() {
    const canvas = document.getElementById('pressureChart');
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (pressureHistory.length < 2) {
        // Show placeholder text
        ctx.fillStyle = '#64748b';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Pressure data will appear here', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Draw pressure trend line
    drawLineChart(ctx, pressureHistory, canvas.width, canvas.height, '#1e40af', 'inHg');
}

function updateTemperatureChart() {
    const canvas = document.getElementById('tempChart');
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (temperatureHistory.length < 2) {
        // Show placeholder text
        ctx.fillStyle = '#64748b';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Temperature data will appear here', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Check if we have high/low data
    const hasHighLowData = temperatureHistory.some(item => item.high !== undefined && item.low !== undefined);
    
    if (hasHighLowData) {
        // Draw temperature range chart with high/low
        drawTemperatureRangeChart(ctx, temperatureHistory, canvas.width, canvas.height, '#10b981');
    } else {
        // Draw simple temperature trend line
        drawLineChart(ctx, temperatureHistory, canvas.width, canvas.height, '#10b981');
    }
}

function updateWaterTemperatureHistory(tempF) {
    const now = new Date();
    const currentHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    
    // Check if we already have data for this hour
    const existingIndex = waterTemperatureHistory.findIndex(
        item => new Date(item.timestamp).getTime() === currentHour.getTime()
    );
    
    if (existingIndex >= 0) {
        // Update existing entry
        waterTemperatureHistory[existingIndex].value = tempF;
    } else {
        // Add new entry
        waterTemperatureHistory.push({
            timestamp: currentHour,
            value: tempF
        });
    }
    
    // Keep only last 24 hours of data
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    waterTemperatureHistory = waterTemperatureHistory.filter(
        item => new Date(item.timestamp) >= oneDayAgo
    );
    
    // Sort by timestamp
    waterTemperatureHistory.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    // Update chart
    updateWaterTemperatureChart();
    
    // Save to storage
    saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
}

function updateWaterTemperatureChart() {
    const canvas = document.getElementById('waterTempChart');
    if (!canvas) return; // Chart canvas doesn't exist yet
    
    const ctx = canvas.getContext('2d');
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (isUsingEstimatedWaterTemp) {
        // Show disabled state for estimated temperature
        ctx.fillStyle = '#94a3b8'; // Gray color for disabled state
        ctx.font = 'bold 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw disabled icon or text
        ctx.fillText('📊', canvas.width / 2, canvas.height / 2 - 20);
        ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Chart disabled for estimated temperature', canvas.width / 2, canvas.height / 2 + 5);
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.fillText('Historical data not available', canvas.width / 2, canvas.height / 2 + 25);
        return;
    }
    
    if (waterTemperatureHistory.length < 2) {
        // Show placeholder text
        ctx.fillStyle = '#64748b';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Water temperature data will appear here', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Draw water temperature trend line
    drawLineChart(ctx, waterTemperatureHistory, canvas.width, canvas.height, '#0ea5e9');
}

function drawTemperatureRangeChart(ctx, data, width, height, color) {
    const padding = 50;
    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;
    
    // Get min and max values from high/low data
    const allValues = [];
    data.forEach(item => {
        if (item.high !== undefined) allValues.push(item.high);
        if (item.low !== undefined) allValues.push(item.low);
        if (item.value !== undefined) allValues.push(item.value);
    });
    
    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const valueRange = rawMax - rawMin || 1;
    const valuePadding = valueRange * 0.1;
    const minValue = rawMin - valuePadding;
    const maxValue = rawMax + valuePadding;
    const adjustedRange = maxValue - minValue;
    
    // Clear background
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-secondary') || '#f3f4f6';
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid lines
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--border-color') || '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    
    for (let i = 0; i <= 4; i++) {
        const y = padding + (i / 4) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(width - padding, y);
        ctx.stroke();
    }
    
    for (let i = 1; i < 4; i++) {
        const x = padding + (i / 4) * chartWidth;
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
    }
    
    ctx.setLineDash([]);
    
    // Draw axes
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary') || '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
    
    // Draw value labels (Y-axis)
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary') || '#1f2937';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i <= 4; i++) {
        const y = padding + (i / 4) * chartHeight;
        const value = maxValue - (i / 4) * adjustedRange;
        const label = Math.round(value) + '°F';
        ctx.fillText(label, padding - 10, y);
    }
    
    // Draw time labels (X-axis)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    
    if (data.length > 1) {
        const indices = [0, Math.floor(data.length / 2), data.length - 1];
        indices.forEach(index => {
            if (data[index] && data[index].time) {
                const x = padding + (index / (data.length - 1)) * chartWidth;
                const time = new Date(data[index].time);
                const timeLabel = time.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric' 
                });
                ctx.fillText(timeLabel, x, height - padding + 10);
            }
        });
    }
    
    // Draw temperature range area
    const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
    gradient.addColorStop(0, color + '30');
    gradient.addColorStop(1, color + '10');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    
    // Draw top line (highs)
    data.forEach((item, index) => {
        const x = padding + (index / (data.length - 1)) * chartWidth;
        const y = height - padding - ((item.high - minValue) / adjustedRange) * chartHeight;
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    // Draw bottom line (lows) in reverse
    for (let i = data.length - 1; i >= 0; i--) {
        const item = data[i];
        const x = padding + (i / (data.length - 1)) * chartWidth;
        const y = height - padding - ((item.low - minValue) / adjustedRange) * chartHeight;
        ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    ctx.fill();
    
    // Draw high temperature line
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 3;
    
    ctx.beginPath();
    data.forEach((item, index) => {
        const x = padding + (index / (data.length - 1)) * chartWidth;
        const y = height - padding - ((item.high - minValue) / adjustedRange) * chartHeight;
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Draw low temperature line
    ctx.strokeStyle = color + 'AA'; // Slightly transparent
    ctx.lineWidth = 2;
    ctx.shadowBlur = 2;
    
    ctx.beginPath();
    data.forEach((item, index) => {
        const x = padding + (index / (data.length - 1)) * chartWidth;
        const y = height - padding - ((item.low - minValue) / adjustedRange) * chartHeight;
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    ctx.shadowBlur = 0;
    
    // Draw data points for highs
    ctx.fillStyle = color;
    data.forEach((item, index) => {
        const x = padding + (index / (data.length - 1)) * chartWidth;
        const yHigh = height - padding - ((item.high - minValue) / adjustedRange) * chartHeight;
        const yLow = height - padding - ((item.low - minValue) / adjustedRange) * chartHeight;
        
        // High point
        ctx.beginPath();
        ctx.arc(x, yHigh, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Low point
        ctx.beginPath();
        ctx.arc(x, yLow, 3, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color + 'AA';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.fillStyle = color;
    });
    
    // Show current values (last point)
    if (data.length > 0) {
        const lastItem = data[data.length - 1];
        const x = padding + chartWidth;
        const yHigh = height - padding - ((lastItem.high - minValue) / adjustedRange) * chartHeight;
        const yLow = height - padding - ((lastItem.low - minValue) / adjustedRange) * chartHeight;
        
        // Labels
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary') || '#1f2937';
        ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(lastItem.high) + '°', x + 15, yHigh);
        ctx.fillText(Math.round(lastItem.low) + '°', x + 15, yLow);
    }
}

function drawLineChart(ctx, data, width, height, color, units = '°F') {
    // Adjust padding based on units - pressure labels need more space
    const leftPadding = units === 'inHg' ? 80 : 50;
    const rightPadding = 50;
    const topPadding = 50;
    const bottomPadding = 50;
    
    const chartWidth = width - leftPadding - rightPadding;
    const chartHeight = height - topPadding - bottomPadding;
    
    // Get min and max values with some padding
    const values = data.map(item => item.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const valueRange = rawMax - rawMin || 1;
    const valuePadding = valueRange * 0.1; // 10% padding
    const minValue = rawMin - valuePadding;
    const maxValue = rawMax + valuePadding;
    const adjustedRange = maxValue - minValue;
    
    // Clear background
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-secondary') || '#f3f4f6';
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid lines
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--border-color') || '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    
    // Horizontal grid lines (5 lines)
    for (let i = 0; i <= 4; i++) {
        const y = topPadding + (i / 4) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(leftPadding, y);
        ctx.lineTo(width - rightPadding, y);
        ctx.stroke();
    }
    
    // Vertical grid lines (4 lines)
    for (let i = 1; i < 4; i++) {
        const x = leftPadding + (i / 4) * chartWidth;
        ctx.beginPath();
        ctx.moveTo(x, topPadding);
        ctx.lineTo(x, height - bottomPadding);
        ctx.stroke();
    }
    
    ctx.setLineDash([]); // Reset line dash
    
    // Draw axes with thicker lines
    ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--text-secondary') || '#64748b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftPadding, topPadding);
    ctx.lineTo(leftPadding, height - bottomPadding);
    ctx.lineTo(width - rightPadding, height - bottomPadding);
    ctx.stroke();
    
    // Draw value labels (Y-axis)
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary') || '#1f2937';
    ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    
    for (let i = 0; i <= 4; i++) {
        const y = topPadding + (i / 4) * chartHeight;
        const value = maxValue - (i / 4) * adjustedRange;
        // Format values based on units
        let label;
        if (units === 'inHg') {
            label = value.toFixed(2) + ' inHg';
        } else {
            label = Math.round(value) + units;
        }
        ctx.fillText(label, leftPadding - 10, y);
    }
    
    // Draw time labels (X-axis)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    
    if (data.length > 1) {
        // For pressure data, show time labels; for daily data, show date labels
        const showDates = data.length <= 24; // Daily data or multi-day data
        
        if (showDates && data.length > 5) {
            // For multi-day data, show up to 5 day labels evenly spaced
            const uniqueDays = new Map();
            data.forEach((item, index) => {
                const timestamp = new Date(item.time || item.timestamp);
                const dayKey = timestamp.toDateString();
                if (!uniqueDays.has(dayKey)) {
                    uniqueDays.set(dayKey, { timestamp, index });
                }
            });
            
            const dayEntries = Array.from(uniqueDays.values());
            if (dayEntries.length > 1) {
                // Show up to 5 day labels evenly distributed
                const maxLabels = Math.min(5, dayEntries.length);
                const labelIndices = [];
                
                for (let i = 0; i < maxLabels; i++) {
                    const dayIndex = Math.floor(i * (dayEntries.length - 1) / (maxLabels - 1));
                    labelIndices.push(dayEntries[dayIndex].index);
                }
                
                labelIndices.forEach(index => {
                    const x = leftPadding + (index / (data.length - 1)) * chartWidth;
                    const time = new Date(data[index].time || data[index].timestamp);
                    const timeLabel = time.toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric' 
                    });
                    
                    ctx.fillText(timeLabel, x, height - bottomPadding + 10);
                });
            }
        } else {
            // For hourly data or simple data, show 3 evenly spaced labels
            const indices = [0, Math.floor(data.length / 2), data.length - 1];
            indices.forEach(index => {
                if (data[index] && (data[index].time || data[index].timestamp)) {
                    const x = leftPadding + (index / (data.length - 1)) * chartWidth;
                    const time = new Date(data[index].time || data[index].timestamp);
                    let timeLabel;
                    
                    if (showDates) {
                        timeLabel = time.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric' 
                        });
                    } else {
                        timeLabel = time.toLocaleTimeString('en-US', { 
                            hour: 'numeric', 
                            minute: '2-digit',
                            hour12: true 
                        });
                    }
                    
                    ctx.fillText(timeLabel, x, height - bottomPadding + 10);
                }
            });
        }
    }
    
    // Draw gradient fill under line
    const gradient = ctx.createLinearGradient(0, topPadding, 0, height - bottomPadding);
    gradient.addColorStop(0, color + '40'); // 25% opacity
    gradient.addColorStop(1, color + '10'); // 6% opacity
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(leftPadding, height - bottomPadding);
    
    data.forEach((item, index) => {
        const x = leftPadding + (index / (data.length - 1)) * chartWidth;
        const y = height - bottomPadding - ((item.value - minValue) / adjustedRange) * chartHeight;
        
        if (index === 0) {
            ctx.lineTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    ctx.lineTo(width - rightPadding, height - bottomPadding);
    ctx.closePath();
    ctx.fill();
    
    // Draw data line with glow effect
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    // Add glow effect
    ctx.shadowColor = color;
    ctx.shadowBlur = 4;
    
    ctx.beginPath();
    data.forEach((item, index) => {
        const x = leftPadding + (index / (data.length - 1)) * chartWidth;
        const y = height - bottomPadding - ((item.value - minValue) / adjustedRange) * chartHeight;
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Reset shadow
    ctx.shadowBlur = 0;
    
    // Draw data points
    ctx.fillStyle = color;
    data.forEach((item, index) => {
        const x = leftPadding + (index / (data.length - 1)) * chartWidth;
        const y = height - bottomPadding - ((item.value - minValue) / adjustedRange) * chartHeight;
        
        // Draw point with white border
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = color;
    });
    
    // Highlight current value (last point)
    if (data.length > 0) {
        const lastItem = data[data.length - 1];
        const x = leftPadding + chartWidth;
        const y = height - bottomPadding - ((lastItem.value - minValue) / adjustedRange) * chartHeight;
        
        // Draw larger highlighted point
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.stroke();
        
        // Add current value label
        ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--text-primary') || '#1f2937';
        ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        
        // Format current value based on units
        let currentValueLabel;
        if (units === 'inHg') {
            currentValueLabel = lastItem.value.toFixed(2) + ' inHg';
        } else {
            currentValueLabel = Math.round(lastItem.value) + units;
        }
        ctx.fillText(currentValueLabel, x + 15, y);
    }
}

// Navigation
function switchSection(section) {
    // Update active nav button
    navBtns.forEach(btn => btn.classList.remove('active'));
    document.querySelector(`[data-section="${section}"]`).classList.add('active');
    
    // Show relevant content (for mobile)
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => card.style.display = 'block');
    
    // You can add specific section filtering here if needed
}

// PWA Installation
function canShowInstallBanner() {
    const installData = loadFromStorage('installPromptData') || {
        promptCount: 0,
        lastDismissedDate: null,
        installed: false
    };
    
    // Don't show if already installed
    if (installData.installed) {
        return false;
    }
    
    // Don't show if we've already prompted 4 times
    if (installData.promptCount >= 4) {
        console.log('Install banner disabled: Maximum 4 prompts reached');
        return false;
    }
    
    // Don't show if within 7-day cooldown period
    if (installData.lastDismissedDate) {
        const lastDismissed = new Date(installData.lastDismissedDate);
        const now = new Date();
        const daysSinceLastDismiss = (now - lastDismissed) / (1000 * 60 * 60 * 24);
        
        if (daysSinceLastDismiss < 7) {
            console.log(`Install banner disabled: Still in cooldown period (${Math.ceil(7 - daysSinceLastDismiss)} days remaining)`);
            return false;
        }
    }
    
    return true;
}

function showInstallBanner() {
    if (!canShowInstallBanner()) {
        return;
    }
    
    // Track that we're showing the banner
    const installData = loadFromStorage('installPromptData') || {
        promptCount: 0,
        lastDismissedDate: null,
        installed: false
    };
    
    installData.promptCount++;
    saveToStorage('installPromptData', installData);
    
    console.log(`Showing install banner (attempt ${installData.promptCount}/4)`);
    
    // Update banner text to show attempt number
    const bannerText = document.querySelector('.banner-text');
    if (bannerText) {
        if (installData.promptCount === 4) {
            bannerText.textContent = 'Last chance! Install How\'s the Bite for the best experience!';
        } else {
            bannerText.textContent = 'Install How\'s the Bite for the best experience!';
        }
    }
    
    installBanner.classList.add('show');
}

function closeBanner() {
    installBanner.classList.remove('show');
    
    // Track dismissal with cooldown
    const installData = loadFromStorage('installPromptData') || {
        promptCount: 0,
        lastDismissedDate: null,
        installed: false
    };
    
    installData.lastDismissedDate = new Date().toISOString();
    saveToStorage('installPromptData', installData);
    
    const remainingAttempts = 4 - installData.promptCount;
    console.log(`Install banner dismissed - 7-day cooldown period started. ${remainingAttempts} attempts remaining.`);
}

async function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to install prompt: ${outcome}`);
        
        if (outcome === 'accepted') {
            // Mark as installed
            const installData = loadFromStorage('installPromptData') || {
                promptCount: 0,
                lastDismissedDate: null,
                installed: false
            };
            
            installData.installed = true;
            saveToStorage('installPromptData', installData);
            
            console.log('App installed successfully');
        } else {
            // User dismissed the install, start cooldown
            const installData = loadFromStorage('installPromptData') || {
                promptCount: 0,
                lastDismissedDate: null,
                installed: false
            };
            
            installData.lastDismissedDate = new Date().toISOString();
            saveToStorage('installPromptData', installData);
            
            console.log('Install prompt declined - 7-day cooldown period started');
        }
        
        deferredPrompt = null;
        closeBanner();
    }
}

function checkIfAppInstalled() {
    // Check if app is running in standalone mode (PWA installed)
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        console.log('App is running in standalone mode (installed)');
        
        const installData = loadFromStorage('installPromptData') || {
            promptCount: 0,
            lastDismissedDate: null,
            installed: false
        };
        
        installData.installed = true;
        saveToStorage('installPromptData', installData);
        
        // Hide install banner if visible
        installBanner.classList.remove('show');
    }
    
    // Also check for iOS standalone mode
    if (window.navigator && window.navigator.standalone) {
        console.log('App is running in iOS standalone mode (installed)');
        
        const installData = loadFromStorage('installPromptData') || {
            promptCount: 0,
            lastDismissedDate: null,
            installed: false
        };
        
        installData.installed = true;
        saveToStorage('installPromptData', installData);
        
        // Hide install banner if visible
        installBanner.classList.remove('show');
    }
    
    // Debug: Log current install status
    const installData = loadFromStorage('installPromptData');
    if (installData) {
        console.log('Install prompt status:', {
            promptCount: installData.promptCount,
            installed: installData.installed,
            lastDismissedDate: installData.lastDismissedDate,
            canShowBanner: canShowInstallBanner()
        });
    }
}

// Debug function to reset install prompt data (for testing)
function resetInstallPromptData() {
    localStorage.removeItem('installPromptData');
    console.log('Install prompt data reset');
}

// Make debug function available globally for testing
window.resetInstallPromptData = resetInstallPromptData;

// Configuration Error Handling
function showConfigError(message = 'Configuration not found') {
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.innerHTML = `
            <div class="card">
                <h2 class="card-title" style="color: #ef4444;">⚠️ Configuration Error</h2>
                <div style="padding: 1rem; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca; margin-bottom: 1rem;">
                    <p style="color: #991b1b; font-weight: 600; margin-bottom: 0.5rem;">${message}</p>
                    <p style="color: #7f1d1d; font-size: 0.9rem;">Please follow these steps to set up the app:</p>
                </div>
                
                <div style="background: #f8fafc; padding: 1rem; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <h3 style="margin-top: 0; color: #1e40af;">Setup Instructions:</h3>
                    <ol style="color: #374151; line-height: 1.6;">
                        <li>Copy <code>config.example.js</code> to <code>config.js</code></li>
                        <li>Get a free API key from <a href="https://openweathermap.org/api" target="_blank" style="color: #1e40af;">OpenWeatherMap</a></li>
                        <li>Edit <code>config.js</code> and replace the placeholder with your API key</li>
                        <li>Refresh this page</li>
                    </ol>
                    
                    <h4 style="color: #1e40af; margin-top: 1.5rem;">Example config.js:</h4>
                    <pre style="background: #1f2937; color: #f3f4f6; padding: 1rem; border-radius: 6px; overflow-x: auto; font-size: 0.85rem;"><code>const CONFIG = {
    WEATHER_API_KEY: 'your-actual-api-key-here',
    DEBUG_MODE: false,
    DEFAULT_LOCATION: {
        lat: 41.8781,
        lon: -87.6298,
        name: 'Chicago, IL'
    }
};</code></pre>
                </div>
            </div>
        `;
    }
}

// Service Worker Registration
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker registered:', registration);
            })
            .catch(error => {
                console.log('Service Worker registration failed:', error);
            });
    }
}

// Location Search Functions
async function handleSearchInput(e) {
    const query = e.target.value.trim();
    
    if (query.length < 2) {
        hideSearchResults();
        return;
    }
    
    if (isSearching) return;
    
    isSearching = true;
    await searchLocations(query);
    isSearching = false;
}

async function performSearch() {
    const query = locationSearch.value.trim();
    if (!query) return;
    
    await searchLocations(query);
}

async function searchLocations(query) {
    try {
        console.log(`Starting city search for query: "${query}" in state: ${selectedState}`);
        
        if (!selectedState) {
            console.log('No state selected, showing empty results');
            displaySearchResults([]);
            return;
        }
        
        // Search for cities only using OpenWeatherMap geocoding
        // Add state filter to the search query
        const searchQuery = `${query}, ${getStateName(selectedState)}`;
        console.log(`Searching OpenWeatherMap for cities with query: "${searchQuery}"`);
        
        const geocodingResponse = await fetch(
            `${GEOCODING_API_URL}/direct?q=${encodeURIComponent(searchQuery)}&limit=10&appid=${CONFIG.WEATHER_API_KEY}`
        );
        const allLocations = await geocodingResponse.json();
        console.log('OpenWeatherMap response:', allLocations);
        
        // Filter locations to only include cities in the selected state
        const filteredLocations = allLocations.filter(location => {
            // Check if location has a state field that matches
            if (location.state) {
                return location.state === getStateName(selectedState);
            }
            // If no state field, check if the location is within the state bounds
            const detectedState = detectStateFromCoordinates(location.lat, location.lon);
            return detectedState === selectedState;
        });
        
        console.log(`Found ${filteredLocations.length} cities in ${getStateName(selectedState)}`);
        
        displaySearchResults(filteredLocations);
    } catch (error) {
        console.error('City search error:', error);
        displaySearchResults([]);
    }
}

// Removed searchUSGSWaterBodies function - no longer needed since we only search cities

// Clean up - debug function no longer needed since USGS is working

function displaySearchResults(locations) {
    console.log(`displaySearchResults called with ${locations?.length || 0} cities`);
    
    if (!locations || locations.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item">No cities found</div>';
        showSearchResults();
        return;
    }
    
    console.log(`Displaying ${locations.length} cities`);
    
    const resultsHTML = locations.map((location, index) => {
        // City result
        const name = location.name;
        const details = `${location.state || location.country}${location.country !== location.state ? ', ' + location.country : ''}`;
        
        return `
            <div class="search-result-item" data-lat="${location.lat}" data-lon="${location.lon}" data-name="${name}, ${details}">
                <div class="result-name"><span class="material-icons">location_city</span> ${name}</div>
                <div class="result-details">${details}</div>
            </div>
        `;
    }).join('');
    
    searchResults.innerHTML = resultsHTML;
    
    // Add click handlers to results
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lon = parseFloat(item.dataset.lon);
            const name = item.dataset.name;
            
            // City selection - will auto-find nearest water body
            selectLocation(lat, lon, name);
        });
    });
    
    showSearchResults();
}

function showSearchResults() {
    console.log('showSearchResults called - adding show class');
    searchResults.classList.add('show');
}

function hideSearchResults() {
    console.log('hideSearchResults called - removing show class');
    searchResults.classList.remove('show');
}

function selectLocation(lat, lon, name) {
    console.log(`Selecting city: ${name} (${lat}, ${lon}) - will auto-find nearest water body`);
    
    currentLocation = { lat, lon, name };
    locationSearch.value = '';
    hideSearchResults();
    
    // Detect and set the state for this location to ensure proper filtering
    const detectedState = detectStateFromCoordinates(lat, lon);
    if (detectedState && detectedState !== selectedState) {
        console.log(`Updating state from ${selectedState} to ${detectedState} for location selection`);
        setSelectedState(detectedState);
    }
    
    // Add to recent locations
    addToRecentLocations(currentLocation);
    
    // Update UI and fetch weather
    updateLocationDisplay();
    fetchWeatherData();
    
    // Automatically find nearest water body with water temperature data
    showWaterDataLoading();
    
    // Add a small delay to ensure state detection is complete
    setTimeout(() => {
        console.log(`Finding nearest water body for ${name} with state: ${selectedState}, water type: ${selectedWaterType || 'All'}`);
        findNearestUSGSWaterData(lat, lon);
    }, 100);
}

// Removed selectWaterBody function - no longer needed since we only search cities

function addToRecentLocations(location) {
    // Remove if already exists
    recentLocations = recentLocations.filter(loc => 
        !(loc.lat === location.lat && loc.lon === location.lon)
    );
    
    // Add to beginning
    recentLocations.unshift(location);
    
    // Keep only last 5
    recentLocations = recentLocations.slice(0, 5);
    
    // Save to storage
    saveToStorage('recentLocations', recentLocations);
    
    // Update UI with a small delay to avoid interfering with ongoing location selection
    setTimeout(() => {
        displayRecentLocations();
    }, 200);
}

function displayRecentLocations() {
    if (recentLocations.length === 0) {
        recentLocationsDiv.innerHTML = '';
        return;
    }
    
    const recentHTML = `
        <h3>Recent Locations</h3>
        <div class="recent-locations-container">
            ${recentLocations.map(location => `
                <div class="recent-location-item" data-lat="${location.lat}" data-lon="${location.lon}" data-name="${location.name}">
                    ${location.name || 'Unknown Location'}
                </div>
            `).join('')}
        </div>
    `;
    
    recentLocationsDiv.innerHTML = recentHTML;
    
    // Add click handlers
    recentLocationsDiv.querySelectorAll('.recent-location-item').forEach(item => {
        item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lon = parseFloat(item.dataset.lon);
            const name = item.dataset.name;
            
            console.log(`Recent location clicked: ${name}, current water type filter: ${selectedWaterType || 'All'}`);
            selectLocation(lat, lon, name);
        });
    });
}

// Breakdown Functions
function updateBreakdownContent(breakdown, totalScore) {
    if (!breakdown) {
        breakdownContent.innerHTML = '<div class="breakdown-loading">No data available</div>';
        return;
    }
    
    const getScoreClass = (rating) => {
        switch (rating) {
            case 'excellent': return 'excellent';
            case 'good': return 'good';
            case 'fair': return 'fair';
            default: return 'poor';
        }
    };
    
    const getScoreText = (score) => {
        if (score > 0) return `+${score}`;
        return score.toString();
    };
    
    breakdownContent.innerHTML = `
        <div class="breakdown-factor">
            <div>
                <div class="breakdown-factor-name">Air Temperature</div>
                <div style="font-size: 0.75rem; color: #64748b;">${breakdown.airTemperature.details}</div>
            </div>
            <span class="breakdown-factor-score ${getScoreClass(breakdown.airTemperature.rating)}">
                ${getScoreText(breakdown.airTemperature.score)}
            </span>
        </div>
        
        <div class="breakdown-factor">
            <div>
                <div class="breakdown-factor-name">Water Temperature</div>
                <div style="font-size: 0.75rem; color: #64748b;">${breakdown.waterTemperature.details}</div>
            </div>
            <span class="breakdown-factor-score ${getScoreClass(breakdown.waterTemperature.rating)}">
                ${getScoreText(breakdown.waterTemperature.score)}
            </span>
        </div>
        
        <div class="breakdown-factor">
            <div>
                <div class="breakdown-factor-name">Pressure</div>
                <div style="font-size: 0.75rem; color: #64748b;">${breakdown.pressure.details}</div>
            </div>
            <span class="breakdown-factor-score ${getScoreClass(breakdown.pressure.rating)}">
                ${getScoreText(breakdown.pressure.score)}
            </span>
        </div>
        
        <div class="breakdown-factor">
            <div>
                <div class="breakdown-factor-name">Wind</div>
                <div style="font-size: 0.75rem; color: #64748b;">${breakdown.wind.details}</div>
            </div>
            <span class="breakdown-factor-score ${getScoreClass(breakdown.wind.rating)}">
                ${getScoreText(breakdown.wind.score)}
            </span>
        </div>
        
        <div class="breakdown-factor">
            <div>
                <div class="breakdown-factor-name">Weather</div>
                <div style="font-size: 0.75rem; color: #64748b;">${breakdown.weather.details}</div>
            </div>
            <span class="breakdown-factor-score ${getScoreClass(breakdown.weather.rating)}">
                ${getScoreText(breakdown.weather.score)}
            </span>
        </div>
        
        <div class="breakdown-factor">
            <div>
                <div class="breakdown-factor-name">Moon Phase</div>
                <div style="font-size: 0.75rem; color: #64748b;">${breakdown.moon.details}</div>
            </div>
            <span class="breakdown-factor-score ${getScoreClass(breakdown.moon.rating)}">
                ${getScoreText(breakdown.moon.score)}
            </span>
        </div>
        
        <div class="breakdown-total">
            Final Score: ${totalScore}/100
        </div>
    `;
}

// Utility function for debouncing
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Data Storage
function saveToStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.error('Storage error:', error);
    }
}

function loadFromStorage(key) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Storage error:', error);
        return null;
    }
}

function loadStoredData() {
    const storedPressure = loadFromStorage('pressureHistory');
    const storedTemperature = loadFromStorage('temperatureHistory');
    const storedWaterTemperature = loadFromStorage('waterTemperatureHistory');
    const storedRecentLocations = loadFromStorage('recentLocations');
    const storedCurrentLocation = loadFromStorage('currentLocation');
    const storedSelectedState = loadFromStorage('selectedState');
    
    if (storedPressure) pressureHistory = storedPressure;
    if (storedTemperature) temperatureHistory = storedTemperature;
    if (storedWaterTemperature) {
        // Migrate old data format if needed (time -> timestamp)
        waterTemperatureHistory = storedWaterTemperature.map(item => {
            if (item.time && !item.timestamp) {
                return {
                    timestamp: item.time,
                    value: item.value
                };
            }
            return item;
        });
    }
    if (storedRecentLocations) recentLocations = storedRecentLocations;
    if (storedCurrentLocation) {
        currentLocation = storedCurrentLocation;
        updateLocationDisplay();
        
        // Find nearest USGS water temperature data for stored location
        if (currentLocation.lat && currentLocation.lon) {
            showWaterDataLoading();
            findNearestUSGSWaterData(currentLocation.lat, currentLocation.lon);
        }
    }
    
    // Load selected state if available
    if (storedSelectedState) {
        setSelectedState(storedSelectedState);
    }
    
    // Load selected water type if available
    const storedSelectedWaterType = loadFromStorage('selectedWaterType');
    if (storedSelectedWaterType) {
        selectedWaterType = storedSelectedWaterType;
        waterTypeSelector.value = storedSelectedWaterType;
        updateSearchPlaceholder();
    }
    
    // Check if app is already installed
    checkIfAppInstalled();
    
    // Display recent locations
    displayRecentLocations();
    
    // Initialize the water temperature source toggle text
    updateWaterTempSourceToggleText();
}

// Periodic Data Updates
setInterval(() => {
    if (currentLocation) {
        fetchWeatherData();
    }
}, 10 * 60 * 1000); // Update every 10 minutes

// Save data periodically
setInterval(() => {
    saveToStorage('pressureHistory', pressureHistory);
    saveToStorage('temperatureHistory', temperatureHistory);
    saveToStorage('waterTemperatureHistory', waterTemperatureHistory);
}, 5 * 60 * 1000); // Save every 5 minutes

// Offline handling
window.addEventListener('online', () => {
    if (currentLocation) {
        fetchWeatherData();
    }
});

window.addEventListener('offline', () => {
    console.log('App is offline');
});