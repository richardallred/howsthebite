# Hows the Bite Setup Guide

This guide will help you set up Hows the Bite locally for development or personal use.

## Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A local web server (optional, but recommended for full PWA functionality)

## Quick Start

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd fish-app
```

### 2. Configure API Keys

1. Copy the configuration template:
   ```bash
   cp config.example.js config.js
   ```

2. Get a free OpenWeatherMap API key:
   - Visit [OpenWeatherMap API](https://openweathermap.org/api)
   - Sign up for a free account
   - Navigate to your API keys section
   - Copy your API key

3. Edit `config.js` and replace the placeholder:
   ```javascript
   const CONFIG = {
       WEATHER_API_KEY: 'your-actual-api-key-here', // Replace this
       DEBUG_MODE: false,
       DEFAULT_LOCATION: {
           lat: 41.8781,
           lon: -87.6298,
           name: 'Chicago, IL'
       }
   };
   ```

### 3. Serve the Application

#### Option A: Simple HTTP Server (Python)
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```

#### Option B: Live Server (VS Code Extension)
1. Install the "Live Server" extension in VS Code
2. Right-click on `index.html` and select "Open with Live Server"

#### Option C: Node.js HTTP Server
```bash
npx http-server . -p 8000
```

### 4. Open the App

Navigate to `http://localhost:8000` in your web browser.

## Configuration Options

You can customize the app by editing `config.js`:

```javascript
const CONFIG = {
    // Required: Your OpenWeatherMap API key
    WEATHER_API_KEY: 'your-api-key-here',
    
    // Optional: Enable debug logging
    DEBUG_MODE: false,
    
    // Optional: Default location if geolocation fails
    DEFAULT_LOCATION: {
        lat: 41.8781,        // Latitude
        lon: -87.6298,       // Longitude
        name: 'Chicago, IL'  // Display name
    }
};
```

## Features

- **Real-time weather data** from OpenWeatherMap
- **Water temperature data** from USGS water monitoring stations
- **State-based search** for water bodies and locations
- **Fishing score calculation** based on multiple environmental factors
- **Progressive Web App (PWA)** - installable on mobile and desktop
- **Offline support** with cached data
- **Responsive design** for all screen sizes

## Troubleshooting

### Common Issues

1. **"Configuration Error" message**
   - Make sure `config.js` exists and contains your API key
   - Check that your API key is valid and not expired

2. **Weather data not loading**
   - Verify your OpenWeatherMap API key is correct
   - Check your internet connection
   - Look for error messages in the browser console (F12)

3. **Location search not working**
   - Make sure you've selected a state from the dropdown
   - Try different search terms
   - Check that your API key has geocoding permissions

4. **PWA features not working**
   - Serve the app over HTTPS (required for PWA features)
   - Use a local development server instead of opening the file directly

### Browser Console

Press F12 to open developer tools and check the console for error messages.

## Development

### File Structure

```
fish-app/
├── index.html          # Main HTML file
├── app.js              # Application logic
├── styles.css          # Styling
├── manifest.json       # PWA manifest
├── sw.js              # Service worker
├── config.js          # Your API keys (not in git)
├── config.example.js  # Configuration template
├── icons/             # PWA icons
└── screenshots/       # App screenshots
```

### Making Changes

1. Edit the files as needed
2. Test your changes locally
3. Commit your changes (but never commit `config.js`)

### API Usage

The app uses the following APIs:
- **OpenWeatherMap**: Weather data and geocoding
- **USGS Water Services**: Real-time water temperature data

## License

This project is open source. See the repository for license details.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests. 