// Configuration file for Hows the Bite
// Copy this file to config.js and add your actual API keys

const CONFIG = {
    // Get a free API key from: https://openweathermap.org/api
    WEATHER_API_KEY: 'your-openweathermap-api-key-here',
    
    // Optional: Add other configuration options here
    DEBUG_MODE: false,
    DEFAULT_LOCATION: {
        lat: 41.8781,
        lon: -87.6298,
        name: 'Chicago, IL'
    }
};

// Make config available globally
window.CONFIG = CONFIG; 