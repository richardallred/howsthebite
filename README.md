# 🎣 How's the Bite? - Fishing Conditions App

A Progressive Web App (PWA) designed to help anglers check fishing conditions and find out how the bite is on local freshwater bodies like lakes and rivers.

## Features

### 🌊 Water Data Integration
- **Real USGS Water Temperature**: Live water temperature data from nearby USGS monitoring stations
- **Water Body Search**: Search for specific lakes, rivers, and streams with real sensor data
- **Water Type Filtering**: Filter search results by lakes only or rivers/streams only
- **Water Temperature History**: 24-hour tracking of water temperature trends with visual charts
- **Automatic Site Selection**: Automatically finds nearest water temperature sensors for any location

### 🌤️ Weather & Environmental Data
- **Real-time Weather Data**: Current conditions including air temperature, barometric pressure, wind speed, and humidity
- **Weather Forecast**: 5-day forecast with weather icons and temperature predictions
- **Pressure Trends**: 24-hour barometric pressure tracking with visual charts
- **Air Temperature History**: Track air temperature changes over time
- **Moon Phase Information**: Current lunar phase for fishing planning

### 🎯 Intelligent Fishing Score
- **Advanced Scoring Algorithm**: Comprehensive 100-point system based on 6 key factors:
  - Water Temperature (20 points) - Primary factor for fish activity
  - Air Temperature (15 points) - Comfort and fish behavior
  - Barometric Pressure (18 points) - Fish feeding patterns
  - Wind Speed (17 points) - Water surface conditions
  - Weather Conditions (15 points) - Overall environmental factors
  - Moon Phase (15 points) - Lunar influence on fish activity
- **Real-time Score Updates**: Automatically recalculates as conditions change
- **Detailed Breakdown**: See exactly how each factor contributes to your score

### 🗺️ Location & Search Features
- **State-Based Search**: Must select a state before searching (ensures relevant results)
- **Automatic Location Detection**: GPS-based location with automatic state detection
- **Recent Locations**: Quick access to your frequently searched spots
- **USGS Site Integration**: Search and select from thousands of water monitoring stations

### 📱 Progressive Web App Features
- **Installable**: Add to home screen on mobile and desktop
- **Offline Functionality**: Works offline with cached data and service worker
- **Responsive Design**: Mobile-first design that works on all devices
- **Smart Install Prompts**: Respectful install banner with 7-day cooldown and 4-attempt limit
- **Material Design Icons**: Modern, consistent iconography throughout the app

## Quick Start

### For Users
1. **Get a free OpenWeatherMap API key** from [openweathermap.org/api](https://openweathermap.org/api)
2. **Copy the config template**: `cp config.example.js config.js`
3. **Add your API key** to `config.js`
4. **Serve locally** using any HTTP server
5. **Open in browser** and start checking conditions!

### For Developers
See the detailed [SETUP.md](SETUP.md) guide for complete development setup instructions, including local server options, PWA testing, and troubleshooting.

**⚠️ Important**: Never commit your `config.js` file to version control as it contains your API key!

## File Structure

```
hows-the-bite/
├── index.html          # Main HTML file
├── app.js             # Main JavaScript functionality
├── styles.css          # Responsive CSS styles
├── config.js          # Your API keys (not in git)
├── config.example.js  # Configuration template
├── manifest.json      # PWA manifest
├── sw.js             # Service worker for offline functionality
├── .gitignore         # Git ignore file (excludes config.js)
├── README.md         # This documentation
├── SETUP.md          # Detailed setup guide
├── package.json      # Project metadata
├── favicon.ico       # Browser icon
├── favicon.svg       # SVG browser icon
├── icons/            # PWA icons directory
│   ├── icon-72x72.png
│   ├── icon-96x96.png
│   ├── icon-128x128.png
│   ├── icon-144x144.png
│   ├── icon-152x152.png
│   ├── icon-192x192.png
│   ├── icon-384x384.png
│   ├── icon-512x512.png
│   └── icon.svg      # Master SVG icon
└── screenshots/      # App screenshots
    └── desktop.png
```

## How It Works

### Data Sources
- **OpenWeatherMap API**: Real-time weather data and 5-day forecasts
- **USGS Water Services**: Live water temperature data from thousands of monitoring stations across the US
- **Automatic Fallbacks**: Demo data when APIs are unavailable, estimated water temperature when no sensors are nearby

### Advanced Fishing Score (0-100 Points)
Our intelligent algorithm considers 6 key environmental factors that affect fish activity:

1. **Water Temperature (20 points)** - The most important factor
   - Peak performance around 70°F with excellent range 65-75°F
   - Fish become less active as temperatures move away from optimal range
   - Very good: 58-78°F | Good: 50-85°F | Fair: 45-90°F

2. **Barometric Pressure (18 points)** - Affects fish feeding behavior
   - Stable pressure (30.00-30.20 inHg) promotes active feeding
   - Fish become cautious during rapid pressure changes
   - Extreme pressure fluctuations can shut down feeding

3. **Wind Speed (17 points)** - Influences water surface and oxygen levels
   - 8-12 mph provides ideal surface action and oxygen mixing
   - Light winds (5-15 mph) create good fishing conditions
   - Too calm: fish can see lines easily | Too windy: casting becomes difficult

4. **Air Temperature (15 points)** - Overall comfort and seasonal patterns
   - Ideal comfort range 65-75°F for extended fishing sessions
   - Extreme heat or cold affects both angler and fish behavior

5. **Weather Conditions (15 points)** - Sky conditions and precipitation
   - Clear to partly cloudy skies are preferred
   - Light rain can stimulate feeding, storms shut it down
   - Stable conditions generally outperform rapidly changing weather

6. **Moon Phase (15 points)** - Lunar influence on fish activity
   - New and full moons typically provide best feeding periods
   - Quarter moons often result in reduced activity

### Smart Location System
- **State Selection Required**: Ensures relevant and accurate search results
- **GPS Auto-Detection**: Automatically detects your state when using current location
- **Multi-State Search**: For border areas, searches nearby states for the best water temperature data
- **USGS Site Matching**: Automatically finds the nearest water monitoring station with real temperature data

### Data Persistence & Offline Support
- **24-hour Historical Data**: Tracks pressure, air temperature, and water temperature trends
- **localStorage Persistence**: All data saved locally and survives app restarts
- **Automatic Saving**: Data backed up every 5 minutes
- **Offline Functionality**: Service worker enables offline use with cached data

### Progressive Web App Features
- **Respectful Install Prompts**: Maximum 4 prompts with 7-day cooldown periods
- **Cross-Platform**: Works on iOS, Android, Windows, macOS, and Linux
- **Material Design**: Consistent, modern interface with Google Material Icons

## Browser Support

- Chrome 88+ (recommended)
- Firefox 85+
- Safari 14+
- Edge 88+

## Future Enhancements

Potential features to add:
- **Interactive Maps**: Visual mapping with topographical features and water body overlays
- **Fishing Logs**: Track catches and correlate with conditions
- **Social Features**: Share conditions and hot spots with other anglers
- **Tide Information**: Coastal fishing support with tide predictions
- **Push Notifications**: Weather alerts and optimal condition notifications
- **Fish Species Database**: Species-specific optimal conditions and advice
- **Photo Integration**: Add photos to fishing logs and condition reports
- **Community Reports**: User-submitted real-time bite reports

## Contributing

This is a basic implementation that can be extended with:
1. More sophisticated weather APIs
2. Integration with fishing-specific data sources
3. Advanced charting libraries (Chart.js, D3.js)
4. Mapping services (Google Maps, Mapbox)
5. Database integration for historical data

## License

This project is open source and available under the MIT License.

## Troubleshooting

### Common Issues

1. **"Configuration Error" displayed**
   - Make sure `config.js` exists and contains your OpenWeatherMap API key
   - Copy `config.example.js` to `config.js` and add your API key
   - Refresh the page after making changes

2. **Cannot search for locations**
   - You must select a state from the dropdown first
   - The app requires state selection to provide relevant results
   - Try selecting your state again if search is disabled

3. **Weather data not loading**
   - Verify your OpenWeatherMap API key is correct and active
   - Check your internet connection
   - Look for error messages in browser console (F12)

4. **No water temperature data**
   - Water temperature comes from USGS monitoring stations
   - Not all locations have nearby sensors
   - App will estimate water temperature (air temp - 5°F) when sensors aren't available
   - Try searching for specific water bodies with monitoring stations

5. **PWA not installing**
   - Serve the app over HTTPS or localhost (not file:// protocol)
   - Use Chrome, Edge, or other PWA-compatible browsers
   - Install prompts have a 7-day cooldown period after dismissal

6. **Location detection not working**
   - Grant location permissions when prompted
   - Some browsers block location access on non-HTTPS sites
   - You can manually select your state and search for locations

### Demo Mode

The app includes demo data that activates when:
- No configuration file is found
- API key is missing or invalid
- API requests fail
- You're offline

This allows you to test the interface without setting up the weather API immediately.

### Debug Console

Press F12 to open browser developer tools and check the console for detailed error messages and debug information. 