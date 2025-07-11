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

// DOM Elements
const locationBtn = document.getElementById('locationBtn');
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');
const bannerClose = document.getElementById('bannerClose');
const navBtns = document.querySelectorAll('.nav-btn');
const locationName = document.getElementById('locationName');
const locationCoords = document.getElementById('locationCoords');
const locationSearch = document.getElementById('locationSearch');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');
const recentLocationsDiv = document.getElementById('recentLocations');
const breakdownContent = document.getElementById('breakdownContent');
const moonPhaseElement = document.getElementById('moonPhase');
const moonIconElement = document.getElementById('moonIcon');
const stateSelector = document.getElementById('stateSelector');
const waterTypeSelector = document.getElementById('waterTypeSelector');

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
    
    initializeApp();
    setupEventListeners();
    registerServiceWorker();
});

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
}

// Event Listeners
function setupEventListeners() {
    locationBtn.addEventListener('click', getLocation);
    installBtn.addEventListener('click', installApp);
    bannerClose.addEventListener('click', closeBanner);
    
    // State Selector
    stateSelector.addEventListener('change', handleStateChange);
    
    // Water Type Selector
    waterTypeSelector.addEventListener('change', handleWaterTypeChange);
    
    // Location Search
    searchBtn.addEventListener('click', performSearch);
    locationSearch.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });
    
    // Location Search Input
    locationSearch.addEventListener('input', debounce(handleSearchInput, 300));
    
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
        locationSearch.placeholder = 'Search for lakes, rivers, or cities...';
        return;
    }
    
    const stateName = getStateName(selectedState);
    let waterTypeText = '';
    
    if (selectedWaterType === 'LK') {
        waterTypeText = 'lakes';
    } else if (selectedWaterType === 'ST') {
        waterTypeText = 'rivers and streams';
    } else {
        waterTypeText = 'lakes, rivers, or cities';
    }
    
    locationSearch.placeholder = `Search for ${waterTypeText} in ${stateName}...`;
}

function handleStateChange() {
    const newState = stateSelector.value;
    
    if (newState) {
        setSelectedState(newState);
        
        // Clear search input and results
        locationSearch.value = '';
        hideSearchResults();
    } else {
        // Disable search when no state is selected
        selectedState = null;
        locationSearch.disabled = true;
        searchBtn.disabled = true;
        updateSearchPlaceholder();
        locationSearch.value = '';
        hideSearchResults();
    }
}

function handleWaterTypeChange() {
    selectedWaterType = waterTypeSelector.value;
    
    // Update the search placeholder
    updateSearchPlaceholder();
    
    // Clear search input and results to encourage new search
    locationSearch.value = '';
    hideSearchResults();
    
    // Save selected water type to storage
    saveToStorage('selectedWaterType', selectedWaterType);
    
    console.log(`Water type filter changed to: ${selectedWaterType || 'All'}`);
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
        
        // Forecast
        const forecastResponse = await fetch(
            `${API_BASE_URL}/forecast?lat=${currentLocation.lat}&lon=${currentLocation.lon}&appid=${CONFIG.WEATHER_API_KEY}&units=imperial`
        );
        const forecast = await forecastResponse.json();
        
        weatherData = { current: currentWeather, forecast: forecast };
        updateMoonPhase();
        updateWeatherUI();
        updateForecastUI();
        updatePressureData();
        calculateFishingScore();
        
    } catch (error) {
        console.error('Weather API error:', error);
        // Use demo data if API fails
        loadDemoData();
    }
}

function loadDemoData() {
    // Demo data for testing without API key
    weatherData = {
        current: {
            main: {
                temp: 72,
                pressure: 30.15,
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
            list: [
                { dt: Date.now() / 1000, main: { temp: 74 }, weather: [{ main: 'Sunny' }] },
                { dt: (Date.now() / 1000) + 86400, main: { temp: 76 }, weather: [{ main: 'Cloudy' }] },
                { dt: (Date.now() / 1000) + 172800, main: { temp: 71 }, weather: [{ main: 'Rain' }] }
            ]
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
    updatePressureData();
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
    const forecast = weatherData.forecast.list.slice(0, 5);
    
    forecastContainer.innerHTML = forecast.map(item => {
        const date = new Date(item.dt * 1000);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const weatherIcon = getWeatherIcon(item.weather[0].main);
        
        return `
            <div class="forecast-item">
                <div class="forecast-day">${dayName}</div>
                <div class="forecast-icon">${weatherIcon}</div>
                <div class="forecast-temp">${Math.round(item.main.temp)}°F</div>
            </div>
        `;
    }).join('');
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

function updatePressureData() {
    if (!weatherData) return;
    
    const pressure = weatherData.current.main.pressure * 0.02953;
    pressureHistory.push({
        time: new Date(),
        value: pressure
    });
    
    // Keep only last 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    pressureHistory = pressureHistory.filter(item => item.time > twentyFourHoursAgo);
    
    updatePressureChart();
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
    
    // Air Temperature factors (0-15 points, reduced to make room for water temp)
    const airTemp = current.main.temp;
    if (airTemp >= 65 && airTemp <= 75) {
        breakdown.airTemperature.score = 15;
        breakdown.airTemperature.details = `${airTemp.toFixed(1)}°F (Optimal: 65-75°F)`;
        breakdown.airTemperature.rating = 'excellent';
        score += 15;
    } else if (airTemp >= 60 && airTemp <= 80) {
        breakdown.airTemperature.score = 12;
        breakdown.airTemperature.details = `${airTemp.toFixed(1)}°F (Very Good: 60-80°F)`;
        breakdown.airTemperature.rating = 'good';
        score += 12;
    } else if (airTemp >= 55 && airTemp <= 85) {
        breakdown.airTemperature.score = 8;
        breakdown.airTemperature.details = `${airTemp.toFixed(1)}°F (Good: 55-85°F)`;
        breakdown.airTemperature.rating = 'good';
        score += 8;
    } else if (airTemp >= 45 && airTemp <= 95) {
        breakdown.airTemperature.score = 4;
        breakdown.airTemperature.details = `${airTemp.toFixed(1)}°F (Fair: 45-95°F)`;
        breakdown.airTemperature.rating = 'fair';
        score += 4;
    } else {
        breakdown.airTemperature.score = 0;
        breakdown.airTemperature.details = `${airTemp.toFixed(1)}°F (Poor: outside range)`;
        breakdown.airTemperature.rating = 'poor';
    }
    
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
    
    if (waterTemp >= 65 && waterTemp <= 75) {
        breakdown.waterTemperature.score = 20;
        breakdown.waterTemperature.details = `${waterTemp.toFixed(1)}°F (Optimal: 65-75°F)${isEstimated ? ' - estimated' : ''}`;
        breakdown.waterTemperature.rating = 'excellent';
        score += 20;
    } else if (waterTemp >= 58 && waterTemp <= 78) {
        breakdown.waterTemperature.score = 16;
        breakdown.waterTemperature.details = `${waterTemp.toFixed(1)}°F (Very Good: 58-78°F)${isEstimated ? ' - estimated' : ''}`;
        breakdown.waterTemperature.rating = 'good';
        score += 16;
    } else if (waterTemp >= 50 && waterTemp <= 85) {
        breakdown.waterTemperature.score = 12;
        breakdown.waterTemperature.details = `${waterTemp.toFixed(1)}°F (Good: 50-85°F)${isEstimated ? ' - estimated' : ''}`;
        breakdown.waterTemperature.rating = 'good';
        score += 12;
    } else if (waterTemp >= 45 && waterTemp <= 90) {
        breakdown.waterTemperature.score = 6;
        breakdown.waterTemperature.details = `${waterTemp.toFixed(1)}°F (Fair: 45-90°F)${isEstimated ? ' - estimated' : ''}`;
        breakdown.waterTemperature.rating = 'fair';
        score += 6;
    } else if (waterTemp >= 40 && waterTemp <= 95) {
        breakdown.waterTemperature.score = 2;
        breakdown.waterTemperature.details = `${waterTemp.toFixed(1)}°F (Poor: 40-95°F)${isEstimated ? ' - estimated' : ''}`;
        breakdown.waterTemperature.rating = 'poor';
        score += 2;
    } else {
        breakdown.waterTemperature.score = 0;
        breakdown.waterTemperature.details = `${waterTemp.toFixed(1)}°F (Very Poor: outside range)${isEstimated ? ' - estimated' : ''}`;
        breakdown.waterTemperature.rating = 'poor';
    }
    
    // Pressure factors (0-18 points)
    const pressure = current.main.pressure * 0.02953;
    if (pressure >= 30.00 && pressure <= 30.20) {
        breakdown.pressure.score = 18;
        breakdown.pressure.details = `${pressure.toFixed(2)} inHg (Optimal: 30.00-30.20)`;
        breakdown.pressure.rating = 'excellent';
        score += 18;
    } else if (pressure >= 29.90 && pressure <= 30.30) {
        breakdown.pressure.score = 14;
        breakdown.pressure.details = `${pressure.toFixed(2)} inHg (Very Good: 29.90-30.30)`;
        breakdown.pressure.rating = 'good';
        score += 14;
    } else if (pressure >= 29.80 && pressure <= 30.40) {
        breakdown.pressure.score = 9;
        breakdown.pressure.details = `${pressure.toFixed(2)} inHg (Good: 29.80-30.40)`;
        breakdown.pressure.rating = 'good';
        score += 9;
    } else if (pressure >= 29.50 && pressure <= 30.70) {
        breakdown.pressure.score = 4;
        breakdown.pressure.details = `${pressure.toFixed(2)} inHg (Fair: 29.50-30.70)`;
        breakdown.pressure.rating = 'fair';
        score += 4;
    } else {
        breakdown.pressure.score = 0;
        breakdown.pressure.details = `${pressure.toFixed(2)} inHg (Poor: outside range)`;
        breakdown.pressure.rating = 'poor';
    }
    
    // Wind factors (0-17 points)
    const windSpeed = current.wind.speed;
    if (windSpeed >= 8 && windSpeed <= 12) {
        breakdown.wind.score = 17;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Optimal: 8-12 mph)`;
        breakdown.wind.rating = 'excellent';
        score += 17;
    } else if (windSpeed >= 5 && windSpeed <= 15) {
        breakdown.wind.score = 13;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Very Good: 5-15 mph)`;
        breakdown.wind.rating = 'good';
        score += 13;
    } else if (windSpeed >= 3 && windSpeed <= 20) {
        breakdown.wind.score = 8;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Good: 3-20 mph)`;
        breakdown.wind.rating = 'good';
        score += 8;
    } else if ((windSpeed >= 1 && windSpeed < 3) || (windSpeed > 20 && windSpeed <= 25)) {
        breakdown.wind.score = 4;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Fair: light or strong winds)`;
        breakdown.wind.rating = 'fair';
        score += 4;
    } else {
        breakdown.wind.score = 0;
        breakdown.wind.details = `${windSpeed.toFixed(1)} mph (Poor: too calm or too windy)`;
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
    
    // Update breakdown display
    updateBreakdownContent(breakdown, score);
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
            const waterTempData = await fetchWaterTemperatureData(closestSite.site_no);
            
            if (waterTempData) {
                usgsWaterData = {
                    site: closestSite,
                    temperature: waterTempData
                };
                currentWaterBody = closestSite;
                
                // Update the UI to use USGS data
                updateWaterTemperatureDisplay();
                updateNearbyWaterBodiesDisplay();
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
                const waterTempData = await fetchWaterTemperatureData(site.site_no);
                
                if (waterTempData) {
                    console.log(`Successfully got water temperature data from ${site.site_name}: ${waterTempData.temperature_f}°F`);
                    
                    // Update global water data
                    usgsWaterData = {
                        site: site,
                        temperature: waterTempData
                    };
                    currentWaterBody = site;
                    
                    // Update the water temperature display
                    updateWaterTemperatureDisplay();
                    
                    // Update nearby water bodies list to include this site
                    nearbyWaterBodies = nearbyWaterSites;
                    updateNearbyWaterBodiesDisplay();
                    
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
                const waterTempData = await fetchWaterTemperatureData(site.site_no);
                
                if (waterTempData) {
                    console.log(`Unexpectedly found water temperature data from ${site.site_name}: ${waterTempData.temperature_f}°F`);
                    
                    // Update global water data
                    usgsWaterData = {
                        site: site,
                        temperature: waterTempData
                    };
                    currentWaterBody = site;
                    
                    // Update the water temperature display
                    updateWaterTemperatureDisplay();
                    
                    // Update nearby water bodies list to include this site
                    nearbyWaterBodies = nearbyWaterSites;
                    updateNearbyWaterBodiesDisplay();
                    
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
        updateNearbyWaterBodiesDisplay();
        
    } catch (error) {
        console.error('Error finding nearest USGS water data:', error);
    }
}

async function findNearbyWaterSites(lat, lon, radiusKm = 150) {
    try {
        console.log(`Searching for water sites within ${radiusKm}km of ${lat}, ${lon}`);
        
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
                    return 'LK,ST,ES'; // All water bodies
                }
            };
            
            const baseSiteTypes = getSiteTypes();
            
            // Try multiple search strategies for each state
            const searchStrategies = [
                // Water temperature sensors (highest priority)
                { parameterCd: WATER_TEMP_PARAM_CODE_F, siteType: baseSiteTypes, description: 'water temp (F)' },
                { parameterCd: WATER_TEMP_PARAM_CODE, siteType: baseSiteTypes, description: 'water temp (C)' },
                { parameterCd: WATER_TEMP_PARAM_CODE_F, siteType: '', description: 'water temp (F) all sites' },
                
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
        
        console.log(`Found ${uniqueSites.length} unique sites total within ${radiusKm}km`);
        
        // Sort by distance and prioritize water temperature sites
        const sortedSites = uniqueSites.sort((a, b) => {
            // Prioritize water temperature sites
            if (a.has_water_temp && !b.has_water_temp) return -1;
            if (!a.has_water_temp && b.has_water_temp) return 1;
            // Then sort by distance
            return a.distance - b.distance;
        });
        
        // Return top 20 sites
        return sortedSites.slice(0, 20);
        
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
    if (score >= 85) return 'Exceptional fishing conditions!';
    if (score >= 70) return 'Excellent fishing weather';
    if (score >= 55) return 'Good fishing conditions';
    if (score >= 40) return 'Fair conditions';
    if (score >= 25) return 'Poor conditions';
    if (score >= 10) return 'Very poor conditions';
    return 'Terrible conditions';
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
    
    if (usgsWaterData && usgsWaterData.temperature) {
        const temp = usgsWaterData.temperature;
        const tempText = `${Math.round(temp.temperature_f)}°F`;
        const dateTime = new Date(temp.datetime);
        const timeAgo = getTimeAgo(dateTime);
        const distance = usgsWaterData.site.distance;
        
        waterTempElement.textContent = tempText;
        
        // Create detailed tooltip showing source and distance
        let tooltipText = `From ${usgsWaterData.site.site_name} - ${timeAgo}`;
        if (distance && distance > 0) {
            tooltipText += ` (${distance.toFixed(1)} km away)`;
        }
        waterTempElement.title = tooltipText;
        
        // Add indicator that this is real USGS data
        waterTempElement.style.color = '#10b981';
        waterTempElement.style.fontWeight = 'bold';
        
        // Update water temperature history
        updateWaterTemperatureHistory(temp.temperature_f);
        
        console.log(`Water temperature updated: ${tempText} from ${usgsWaterData.site.site_name}${distance > 0 ? ` (${distance.toFixed(1)} km away)` : ''}`);
    } else if (weatherData) {
        // Fallback to estimated temperature
        const estimatedTemp = Math.round(weatherData.current.main.temp - 5);
        waterTempElement.textContent = `${estimatedTemp}°F`;
        waterTempElement.title = 'Estimated from air temperature (no nearby water temperature sensors found)';
        waterTempElement.style.color = '#64748b';
        waterTempElement.style.fontWeight = 'normal';
        
        // Update water temperature history with estimated value
        updateWaterTemperatureHistory(estimatedTemp);
        
        console.log(`Water temperature estimated: ${estimatedTemp}°F (no USGS data available)`);
    }
}

function updateNearbyWaterBodiesDisplay() {
    const mapContainer = document.querySelector('.map-container');
    
    if (nearbyWaterBodies.length > 0) {
        const waterBodiesHTML = `
            <div class="water-bodies-list">
                <h3>Nearby Water Bodies with Temperature Data</h3>
                ${nearbyWaterBodies.slice(0, 5).map(site => {
                    const distance = site.distance.toFixed(1);
                    const isActive = currentWaterBody && currentWaterBody.site_no === site.site_no;
                    
                    return `
                        <div class="water-body-item ${isActive ? 'active' : ''}" 
                             data-site-no="${site.site_no}" 
                             data-lat="${site.latitude}" 
                             data-lon="${site.longitude}"
                             data-name="${site.site_name}">
                            <div class="water-body-info">
                                <div class="water-body-name">${site.site_name}</div>
                                <div class="water-body-details">
                                    ${site.site_type} • ${distance} km away
                                    ${isActive ? ' • <span class="active-indicator">Active</span>' : ''}
                                </div>
                            </div>
                            <div class="water-body-actions">
                                <button class="select-water-body-btn" data-site-no="${site.site_no}">
                                    ${isActive ? 'Current' : 'Select'}
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
        
        mapContainer.innerHTML = waterBodiesHTML;
        
        // Add click handlers for water body selection
        const selectButtons = mapContainer.querySelectorAll('.select-water-body-btn');
        selectButtons.forEach(button => {
            button.addEventListener('click', async (e) => {
                const siteNo = e.target.dataset.siteNo;
                const site = nearbyWaterBodies.find(s => s.site_no === siteNo);
                
                if (site) {
                    // Update current location to this water body
                    currentWaterBody = site;
                    
                    // Fetch water temperature data for this site
                    const waterTempData = await fetchWaterTemperatureData(site.site_no);
                    
                    if (waterTempData) {
                        usgsWaterData = {
                            site: site,
                            temperature: waterTempData
                        };
                        
                        // Update displays
                        updateWaterTemperatureDisplay();
                        updateNearbyWaterBodiesDisplay();
                    }
                }
            });
        });
        
        // Add click handlers for water body items
        const waterBodyItems = mapContainer.querySelectorAll('.water-body-item');
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
        mapContainer.innerHTML = `
            <div class="no-water-bodies">
                <div class="no-water-bodies-icon">🌊</div>
                <div class="no-water-bodies-text">No USGS water temperature monitoring sites found in this area</div>
                <div class="no-water-bodies-subtext">Water temperature will be estimated from air temperature</div>
            </div>
        `;
    }
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
    drawLineChart(ctx, pressureHistory, canvas.width, canvas.height, '#1e40af');
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
    
    // Draw temperature trend line
    drawLineChart(ctx, temperatureHistory, canvas.width, canvas.height, '#10b981');
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
    
    if (waterTemperatureHistory.length < 2) {
        // Show placeholder text
        ctx.fillStyle = '#64748b';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Water temperature data will appear here', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    // Draw water temperature trend line
    drawLineChart(ctx, waterTemperatureHistory, canvas.width, canvas.height, '#0ea5e9');
}

function drawLineChart(ctx, data, width, height, color) {
    const padding = 20;
    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;
    
    // Get min and max values
    const values = data.map(item => item.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = maxValue - minValue || 1;
    
    // Draw axes
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();
    
    // Draw data line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    data.forEach((item, index) => {
        const x = padding + (index / (data.length - 1)) * chartWidth;
        const y = height - padding - ((item.value - minValue) / valueRange) * chartHeight;
        
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    
    ctx.stroke();
    
    // Draw data points
    ctx.fillStyle = color;
    data.forEach((item, index) => {
        const x = padding + (index / (data.length - 1)) * chartWidth;
        const y = height - padding - ((item.value - minValue) / valueRange) * chartHeight;
        
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, 2 * Math.PI);
        ctx.fill();
    });
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
            bannerText.textContent = 'Last chance! Install Hows the Bite for the best experience!';
        } else {
            bannerText.textContent = 'Install Hows the Bite for the best experience!';
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
        console.log(`Starting search for query: "${query}" in state: ${selectedState}`);
        
        if (!selectedState) {
            console.log('No state selected, showing empty results');
            displaySearchResults([]);
            return;
        }
        
        // Search for regular locations using OpenWeatherMap geocoding
        // Add state filter to the search query
        const searchQuery = `${query}, ${getStateName(selectedState)}`;
        console.log(`Searching OpenWeatherMap with query: "${searchQuery}"`);
        
        const geocodingResponse = await fetch(
            `${GEOCODING_API_URL}/direct?q=${encodeURIComponent(searchQuery)}&limit=10&appid=${CONFIG.WEATHER_API_KEY}`
        );
        const allLocations = await geocodingResponse.json();
        console.log('OpenWeatherMap response:', allLocations);
        
        // Filter locations to only include those in the selected state
        const filteredLocations = allLocations.filter(location => {
            // Check if location has a state field that matches
            if (location.state) {
                return location.state === getStateName(selectedState);
            }
            // If no state field, check if the location is within the state bounds
            const detectedState = detectStateFromCoordinates(location.lat, location.lon);
            return detectedState === selectedState;
        });
        
        console.log(`Filtered to ${filteredLocations.length} regular locations`);
        
        // Search for USGS water bodies in the selected state
        const waterBodySites = await searchUSGSWaterBodies(query);
        console.log(`Found ${waterBodySites.length} water body sites`);
        
        // Combine results
        const combinedResults = [...filteredLocations, ...waterBodySites];
        console.log(`Combined results (${combinedResults.length} total):`, combinedResults);
        
        displaySearchResults(combinedResults);
    } catch (error) {
        console.error('Location search error:', error);
        displaySearchResults([]);
    }
}

async function searchUSGSWaterBodies(query) {
    try {
        if (!selectedState) {
            console.log('No state selected, skipping USGS search');
            return [];
        }
        
        const queryLower = query.toLowerCase();
        const allWaterBodies = [];
        
        try {
            // Get the appropriate site types based on water type filter
            const getSiteTypesForSearch = () => {
                if (selectedWaterType === 'LK') {
                    return 'LK'; // Lakes only
                } else if (selectedWaterType === 'ST') {
                    return 'ST'; // Streams/rivers only
                } else {
                    return 'LK,ST'; // All water bodies for search
                }
            };
            
            const baseSiteTypes = getSiteTypesForSearch();
            console.log(`Filtering search by water type: ${selectedWaterType || 'All'} (site types: ${baseSiteTypes})`);
            
            // Try multiple parameter codes and site types to find water monitoring sites
            const searchParams = [
                // Water temperature in Fahrenheit
                { parameterCd: WATER_TEMP_PARAM_CODE_F, siteType: baseSiteTypes, description: `water temp (F) at ${selectedWaterType === 'LK' ? 'lakes' : selectedWaterType === 'ST' ? 'streams' : 'lakes/streams'}` },
                // Water temperature in Celsius  
                { parameterCd: WATER_TEMP_PARAM_CODE, siteType: baseSiteTypes, description: `water temp (C) at ${selectedWaterType === 'LK' ? 'lakes' : selectedWaterType === 'ST' ? 'streams' : 'lakes/streams'}` },
                // Any site type with water temperature (only if no specific type selected)
                ...(selectedWaterType ? [] : [{ parameterCd: WATER_TEMP_PARAM_CODE_F, siteType: '', description: 'water temp (F) all sites' }]),
                // Streamflow (only if looking for streams or all)
                ...(selectedWaterType !== 'LK' ? [{ parameterCd: '00060', siteType: 'ST', description: 'streamflow at streams' }] : []),
                // Any active site of the selected type
                { parameterCd: '', siteType: baseSiteTypes, description: `all parameters at ${selectedWaterType === 'LK' ? 'lakes' : selectedWaterType === 'ST' ? 'streams' : 'lakes/streams'}` }
            ];
            
            let timeSeries = null;
            let usedParams = null;
            
            for (const params of searchParams) {
                const apiUrl = `${USGS_IV_API_URL}?format=json&stateCd=${selectedState}${params.parameterCd ? '&parameterCd=' + params.parameterCd : ''}${params.siteType ? '&siteType=' + params.siteType : ''}&siteStatus=active`;
                console.log(`Trying ${params.description}: ${apiUrl}`);
                
                const response = await fetch(apiUrl);
                
                if (!response.ok) {
                    console.log(`USGS API failed for ${params.description}: ${response.status}`);
                    continue;
                }
                
                const data = await response.json();
                
                // Parse the response structure
                if (data.value && data.value.timeSeries) {
                    timeSeries = data.value.timeSeries;
                } else if (data.value && data.value.value && data.value.value.timeSeries) {
                    timeSeries = data.value.value.timeSeries;
                } else if (data.timeSeries) {
                    timeSeries = data.timeSeries;
                }
                
                if (timeSeries && timeSeries.length > 0) {
                    console.log(`Success! Found ${timeSeries.length} sites using ${params.description}`);
                    usedParams = params;
                    break;
                } else {
                    console.log(`No sites found using ${params.description}`);
                }
            }
            
            if (!timeSeries || timeSeries.length === 0) {
                console.log('No USGS sites found with any search parameters');
                return [];
            }
            
            console.log(`Found ${timeSeries.length} total USGS sites in ${selectedState} using ${usedParams.description}`);
            
            // Filter sites by name match - try multiple search approaches
            let matchingSites = [];
            
            // First, try exact search
            matchingSites = timeSeries.filter(timeSeriesItem => {
                const siteName = timeSeriesItem.sourceInfo.siteName.toLowerCase();
                const matches = siteName.includes(queryLower);
                if (matches) {
                    console.log(`Found exact matching site: ${siteName}`);
                }
                return matches;
            });
            
            // If no exact matches, try broader search with water-related terms
            if (matchingSites.length === 0 && queryLower.length > 2) {
                console.log('No exact matches found, trying broader water body search');
                const waterTerms = ['lake', 'river', 'creek', 'pond', 'reservoir', 'stream', 'bay', 'inlet'];
                const hasWaterTerm = waterTerms.some(term => queryLower.includes(term));
                
                if (hasWaterTerm) {
                    matchingSites = timeSeries.filter(timeSeriesItem => {
                        const siteName = timeSeriesItem.sourceInfo.siteName.toLowerCase();
                        // Check if site name contains water-related terms
                        return waterTerms.some(term => siteName.includes(term));
                    }).slice(0, 5); // Limit to 5 results
                    
                    console.log(`Found ${matchingSites.length} sites with water-related terms`);
                }
            }
            
            // If still no matches, try searching for any site that contains individual words from the query
            if (matchingSites.length === 0 && queryLower.length > 3) {
                console.log('No matches found, trying word-based search');
                const queryWords = queryLower.split(' ').filter(word => word.length > 2);
                
                matchingSites = timeSeries.filter(timeSeriesItem => {
                    const siteName = timeSeriesItem.sourceInfo.siteName.toLowerCase();
                    return queryWords.some(word => siteName.includes(word));
                }).slice(0, 5);
                
                console.log(`Found ${matchingSites.length} sites with word-based search`);
            }
            
            // If still no matches, just show a few sites from the state for testing
            if (matchingSites.length === 0) {
                console.log('No matches found with any search strategy, showing sample sites for testing');
                matchingSites = timeSeries.slice(0, 3);
                console.log(`Showing ${matchingSites.length} sample sites for testing`);
            }
            
            console.log(`Found ${matchingSites.length} matching sites for query: "${query}"`);
            
            // Add matching sites to results
            const waterBodies = matchingSites.map(timeSeriesItem => {
                const siteInfo = timeSeriesItem.sourceInfo;
                const siteLatLon = siteInfo.geoLocation.geogLocation;
                
                const waterBody = {
                    lat: parseFloat(siteLatLon.latitude),
                    lon: parseFloat(siteLatLon.longitude),
                    name: siteInfo.siteName,
                    site_no: siteInfo.siteCode[0].value,
                    site_type: siteInfo.siteProperty.find(prop => prop.name === 'siteTypeCd')?.value || 'Water Body',
                    has_water_temp: true,
                    is_water_body: true,
                    state: selectedState
                };
                
                console.log('Created water body result:', waterBody);
                return waterBody;
            });
            
            allWaterBodies.push(...waterBodies);
            
        } catch (stateError) {
            console.log(`Error searching state ${selectedState}:`, stateError);
        }
        
        console.log(`Returning ${allWaterBodies.length} water body results`);
        // Return top 5 matches
        return allWaterBodies.slice(0, 5);
        
    } catch (error) {
        console.error('USGS water body search error:', error);
        return [];
    }
}

// Clean up - debug function no longer needed since USGS is working

function displaySearchResults(locations) {
    console.log(`displaySearchResults called with ${locations?.length || 0} locations`);
    
    if (!locations || locations.length === 0) {
        searchResults.innerHTML = '<div class="search-result-item">No locations found</div>';
        showSearchResults();
        return;
    }
    
    // Count how many are water bodies vs regular locations
    const waterBodyCount = locations.filter(loc => loc.is_water_body).length;
    const regularLocationCount = locations.length - waterBodyCount;
    console.log(`Displaying ${regularLocationCount} regular locations and ${waterBodyCount} water bodies`);
    
    const resultsHTML = locations.map((location, index) => {
        if (location.is_water_body) {
            // Water body result with appropriate icon
            const typeIcon = location.site_type === 'LK' ? '<span class="material-icons">landscape</span>' : location.site_type === 'ST' ? '<span class="material-icons">waves</span>' : '<span class="material-icons">water_drop</span>';
            const typeText = location.site_type === 'LK' ? 'Lake' : location.site_type === 'ST' ? 'Stream/River' : location.site_type;
            
            return `
                <div class="search-result-item water-body-result" 
                     data-lat="${location.lat}" 
                     data-lon="${location.lon}" 
                     data-name="${location.name}"
                     data-site-no="${location.site_no}"
                     data-site-type="${location.site_type}">
                    <div class="result-name">${typeIcon} ${location.name}</div>
                    <div class="result-details">${typeText} • Real water temperature data</div>
                </div>
            `;
        } else {
            // Regular location result
            const name = location.name;
            const details = `${location.state || location.country}${location.country !== location.state ? ', ' + location.country : ''}`;
            
            return `
                <div class="search-result-item" data-lat="${location.lat}" data-lon="${location.lon}" data-name="${name}, ${details}">
                    <div class="result-name">${name}</div>
                    <div class="result-details">${details}</div>
                </div>
            `;
        }
    }).join('');
    
    searchResults.innerHTML = resultsHTML;
    
    // Add click handlers to results
    searchResults.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
            const lat = parseFloat(item.dataset.lat);
            const lon = parseFloat(item.dataset.lon);
            const name = item.dataset.name;
            const siteNo = item.dataset.siteNo;
            const siteType = item.dataset.siteType;
            
            if (siteNo) {
                // Water body selection
                selectWaterBody(lat, lon, name, siteNo, siteType);
            } else {
                // Regular location selection
                selectLocation(lat, lon, name);
            }
        });
    });
    
    showSearchResults();
}

function showSearchResults() {
    searchResults.classList.add('show');
}

function hideSearchResults() {
    searchResults.classList.remove('show');
}

function selectLocation(lat, lon, name) {
    currentLocation = { lat, lon, name };
    locationSearch.value = '';
    hideSearchResults();
    
    // Add to recent locations
    addToRecentLocations(currentLocation);
    
    // Update UI and fetch weather
    updateLocationDisplay();
    fetchWeatherData();
    
    // Find nearest USGS water temperature data
    findNearestUSGSWaterData(lat, lon);
}

async function selectWaterBody(lat, lon, name, siteNo, siteType) {
    currentLocation = { lat, lon, name };
    locationSearch.value = '';
    hideSearchResults();
    
    // Set this as the current water body
    currentWaterBody = {
        site_no: siteNo,
        site_name: name,
        latitude: lat,
        longitude: lon,
        site_type: siteType,
        has_water_temp: true,
        distance: 0 // This is the selected location
    };
    
    // Add to recent locations
    addToRecentLocations(currentLocation);
    
    // Update UI and fetch weather and water data
    updateLocationDisplay();
    fetchWeatherData();
    
    // Fetch water temperature data specifically for this site
    try {
        const waterTempData = await fetchWaterTemperatureData(siteNo);
        if (waterTempData) {
            usgsWaterData = {
                site: currentWaterBody,
                temperature: waterTempData
            };
            
            // Update displays
            updateWaterTemperatureDisplay();
            updateNearbyWaterBodiesDisplay();
        }
    } catch (error) {
        console.error('Error fetching water temperature for selected site:', error);
    }
}

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
    
    // Update UI
    displayRecentLocations();
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
    if (storedWaterTemperature) waterTemperatureHistory = storedWaterTemperature;
    if (storedRecentLocations) recentLocations = storedRecentLocations;
    if (storedCurrentLocation) {
        currentLocation = storedCurrentLocation;
        updateLocationDisplay();
        
        // Find nearest USGS water temperature data for stored location
        if (currentLocation.lat && currentLocation.lon) {
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