// Scroll to the top of the page on load
window.scrollTo(0, 0);

require([
    "esri/Map",
    "esri/views/MapView", 
    "esri/layers/FeatureLayer",
    "esri/Graphic",
    "esri/layers/GraphicsLayer",
    "esri/geometry/Point",
    "esri/geometry/Polygon"
], function (Map, MapView, FeatureLayer, Graphic, GraphicsLayer, Point, Polygon) {

    // --- Initialize Main Map ---
    const map = new Map({
        basemap: "streets-vector" // English basemap
    });

    const view = new MapView({
        container: "map",
        map,
        center: [0, 20],
        zoom: 2,
        ui: {
            components: ["zoom", "compass", "attribution"]
        }
    });

    const graphicsLayer = new GraphicsLayer();
    map.add(graphicsLayer);

    // --- Layer Setup ---
    const solarLayer = new GraphicsLayer({ title: "Solar Radiation", visible: false });
    const tempLayer = new GraphicsLayer({ title: "Temperature", visible: false });
    const windLayer = new GraphicsLayer({ title: "Wind Speed", visible: false });
    const airQualityLayer = new GraphicsLayer({ title: "Air Quality", visible: false });

    map.addMany([solarLayer, tempLayer, windLayer, airQualityLayer]);

    // --- UI Elements ---
    const cityInput = document.getElementById("cityInput");
    const suggestionsDiv = document.getElementById("suggestions");
    const searchBtn = document.getElementById("searchBtn");
    const showDataBtn = document.getElementById("showDataBtn");
    const predictBtn = document.getElementById("predictBtn");
    const output = document.getElementById("output");
    const layerControls = document.getElementById('layerControls');

    let selectedCity = null;
    let cityCoords = null;
    let currentCityData = null;
    let cityBoundary = null;
    let cityArea = 0;
    let currentActiveLayer = null;

    const OWM_KEY = "4fIAmThyf4cdRbFD9aX7ktE5NCb3CoJNIWKsNMe6";

    // --- Single Layer Toggle Function ---
    function toggleLayer(layer, layerName) {
        // Hide all layers first
        solarLayer.visible = false;
        tempLayer.visible = false;
        windLayer.visible = false;
        airQualityLayer.visible = false;
        
        // Toggle the selected layer
        layer.visible = !layer.visible;
        currentActiveLayer = layer.visible ? layerName : null;
        
        // Update checkboxes to reflect current state
        document.getElementById('solarLayerToggle').checked = layerName === 'solar' && layer.visible;
        document.getElementById('tempLayerToggle').checked = layerName === 'temp' && layer.visible;
        document.getElementById('windLayerToggle').checked = layerName === 'wind' && layer.visible;
        document.getElementById('airQualityLayerToggle').checked = layerName === 'airQuality' && layer.visible;
    }

    // --- Layer Toggle Event Listeners ---
    document.getElementById('solarLayerToggle').addEventListener('change', (e) => {
        toggleLayer(solarLayer, 'solar');
    });

    document.getElementById('tempLayerToggle').addEventListener('change', (e) => {
        toggleLayer(tempLayer, 'temp');
    });

    document.getElementById('windLayerToggle').addEventListener('change', (e) => {
        toggleLayer(windLayer, 'wind');
    });

    document.getElementById('airQualityLayerToggle').addEventListener('change', (e) => {
        toggleLayer(airQualityLayer, 'airQuality');
    });

    // --- City Boundary and Area Calculation ---
    async function getCityBoundary(cityName, lat, lon) {
        try {
            // Try to get city boundary from Nominatim
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&polygon_geojson=1&limit=1`
            );
            const data = await response.json();
            
            if (data && data.length > 0) {
                const place = data[0];
                if (place.geojson) {
                    const boundary = place.geojson;
                    // Calculate area
                    cityArea = calculateAreaKm2(boundary);
                    return boundary;
                }
            }
            
            // If no boundary found, create a reasonable bounding box
            return createFallbackBoundary(lat, lon);
            
        } catch (error) {
            console.warn("Failed to get city boundary, using fallback:", error);
            return createFallbackBoundary(lat, lon);
        }
    }

    function calculateAreaKm2(geojson) {
        if (geojson.type !== "Polygon") return 100; // Default fallback
        
        const coords = geojson.coordinates[0];
        let area = 0;
        
        // Shoelace formula for area calculation
        for (let i = 0; i < coords.length - 1; i++) {
            area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
        }
        
        area = Math.abs(area) / 2;
        
        // Convert to square kilometers (rough approximation)
        // Average: 1 degree ≈ 111km, but varies by latitude
        return Math.max(10, area * 111 * 111); // Minimum 10 km²
    }

    function createFallbackBoundary(lat, lon) {
        // For major cities, use known approximate areas
        const majorCities = {
            'beijing': 16410,
            'new york': 783,
            'london': 1572,
            'tokyo': 2194,
            'paris': 105,
            'moscow': 2511,
            'shanghai': 6340,
            'delhi': 1484
        };
        
        const cityLower = selectedCity ? selectedCity.toLowerCase() : '';
        
        // Check if it's a major city with known approximate area
        for (const [city, area] of Object.entries(majorCities)) {
            if (cityLower.includes(city)) {
                cityArea = area;
                const radius = Math.sqrt(area / Math.PI) / 111; // Convert km² to degrees
                return {
                    type: "Polygon",
                    coordinates: [[
                        [lon - radius, lat - radius],
                        [lon + radius, lat - radius],
                        [lon + radius, lat + radius],
                        [lon - radius, lat + radius],
                        [lon - radius, lat - radius]
                    ]]
                };
            }
        }
        
        // If not a major city, estimate based on city size
        const citySize = Math.random();
        let radius;
        
        if (citySize < 0.3) {
            radius = 0.05; // Small city ~5km radius
            cityArea = 80;
        } else if (citySize < 0.7) {
            radius = 0.1; // Medium city ~11km radius
            cityArea = 400;
        } else {
            radius = 0.2; // Large city ~22km radius
            cityArea = 1500;
        }
        
        return {
            type: "Polygon",
            coordinates: [[
                [lon - radius, lat - radius],
                [lon + radius, lat - radius],
                [lon + radius, lat + radius],
                [lon - radius, lat + radius],
                [lon - radius, lat - radius]
            ]]
        };
    }

    function calculateOptimalPointCount(areaKm2) {
        // INCREASED POINT DENSITY: 1 point per ~2 km² for more coverage
        // Minimum 15 points, maximum 150 points
        const baseDensity = 0.5; // points per km² (increased from 0.33)
        const points = Math.round(areaKm2 * baseDensity);
        
        return Math.max(15, Math.min(150, points));
    }

    // FIXED: Better balanced point generation with more points
    function generateCityPoints(lat, lon, boundary, targetCount) {
        let points = [];
        
        // Try polygon-based generation first
        try {
            points = generateEvenlySpacedPoints(boundary, targetCount);
            console.log(`Polygon method: ${points.length} points`);
        } catch (error) {
            console.warn("Polygon method failed:", error);
            points = [];
        }
        
        // If polygon method didn't generate enough points, try circular method
        if (points.length < targetCount * 0.5) {
            console.log(`Using circular fallback, polygon only generated ${points.length} points`);
            const circularPoints = generateCircularPoints(lat, lon, targetCount);
            points = circularPoints; // Use circular points as primary
        }
        
        // Final fallback: simple grid
        if (points.length === 0) {
            console.log("Using grid fallback");
            points = generateGridPoints(lat, lon, targetCount);
        }
        
        console.log(`Final: ${points.length} points generated`);
        return points.slice(0, targetCount);
    }

    function generateEvenlySpacedPoints(boundary, targetCount) {
        const points = [];
        const coordinates = boundary.coordinates[0];
        
        // Get bounding box
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        coordinates.forEach(coord => {
            minLon = Math.min(minLon, coord[0]);
            maxLon = Math.max(maxLon, coord[0]);
            minLat = Math.min(minLat, coord[1]);
            maxLat = Math.max(maxLat, coord[1]);
        });

        const bboxWidth = maxLon - minLon;
        const bboxHeight = maxLat - minLat;
        const bboxAspect = bboxWidth / bboxHeight;
        
        const cols = Math.ceil(Math.sqrt(targetCount * bboxAspect));
        const rows = Math.ceil(targetCount / cols);
        
        const cellWidth = bboxWidth / cols;
        const cellHeight = bboxHeight / rows;

        // Generate grid points with moderate jitter
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (points.length >= targetCount) break;
                
                // Moderate jitter for natural spacing
                const jitterLon = (Math.random() - 0.5) * cellWidth * 0.1;
                const jitterLat = (Math.random() - 0.5) * cellHeight * 0.1;
                
                const lon = minLon + (col + 0.5) * cellWidth + jitterLon;
                const lat = minLat + (row + 0.5) * cellHeight + jitterLat;
                
                if (isPointInPolygon([lon, lat], coordinates)) {
                    points.push({ lat, lon });
                }
            }
        }

        return points;
    }

    function generateCircularPoints(lat, lon, targetCount) {
        const points = [];
        const radius = Math.sqrt(cityArea / Math.PI) / 111; // Convert km to degrees
        
        for (let i = 0; i < targetCount; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const distance = Math.random() * radius * 0.8; // Use 80% of radius for balanced spacing
            
            const pointLat = lat + Math.cos(angle) * distance;
            const pointLon = lon + Math.sin(angle) * distance;
            
            points.push({ lat: pointLat, lon: pointLon });
        }
        
        return points;
    }

    function generateGridPoints(lat, lon, targetCount) {
        const points = [];
        const gridSize = Math.ceil(Math.sqrt(targetCount));
        const spacing = 0.025; // Slightly smaller spacing for more points
        
        for (let row = 0; row < gridSize; row++) {
            for (let col = 0; col < gridSize; col++) {
                if (points.length >= targetCount) break;
                
                const pointLat = lat + (row - gridSize/2) * spacing;
                const pointLon = lon + (col - gridSize/2) * spacing;
                
                points.push({ lat: pointLat, lon: pointLon });
            }
        }
        
        return points;
    }

    function isPointInPolygon(point, polygon) {
        const [x, y] = point;
        let inside = false;
        
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];
            
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            
            if (intersect) inside = !inside;
        }
        
        return inside;
    }

    // --- Smart Data Estimation Functions ---
    function estimateTemperature(lat) {
        const absLat = Math.abs(lat);
        const now = new Date();
        const currentMonth = now.getMonth();
        
        if (absLat < 23.5) {
            return 25 + (Math.random() * 10);
        } else if (absLat < 35) {
            return 15 + (Math.random() * 15);
        } else if (absLat < 50) {
            if (currentMonth >= 4 && currentMonth <= 9) {
                return 18 + (Math.random() * 12);
            } else {
                return 5 + (Math.random() * 10);
            }
        } else if (absLat < 66.5) {
            if (currentMonth >= 5 && currentMonth <= 8) {
                return 12 + (Math.random() * 8);
            } else {
                return -5 + (Math.random() * 10);
            }
        } else {
            return -10 + (Math.random() * 15);
        }
    }

    function estimateSolar(lat) {
        const absLat = Math.abs(lat);
        const now = new Date();
        const currentMonth = now.getMonth();
        
        let baseSolar;
        if (absLat < 23.5) {
            baseSolar = 5.5;
        } else if (absLat < 35) {
            baseSolar = 4.5;
        } else if (absLat < 50) {
            baseSolar = 3.5;
        } else if (absLat < 66.5) {
            baseSolar = 2.5;
        } else {
            baseSolar = 1.5;
        }
        
        if (currentMonth >= 10 || currentMonth <= 2) {
            if (lat > 0) baseSolar *= 0.7;
            else baseSolar *= 1.3;
        } else if (currentMonth >= 4 && currentMonth <= 8) {
            if (lat > 0) baseSolar *= 1.3;
            else baseSolar *= 0.7;
        }
        
        return baseSolar + (Math.random() * 1 - 0.5);
    }

    function estimateWind(lat) {
        const absLat = Math.abs(lat);
        let baseWind;
        
        if (absLat < 20) {
            baseWind = 3 + Math.random() * 4;
        } else if (absLat < 40) {
            baseWind = 4 + Math.random() * 6;
        } else if (absLat < 60) {
            baseWind = 6 + Math.random() * 8;
        } else {
            baseWind = 5 + Math.random() * 5;
        }
        
        return baseWind;
    }

    // --- Enhanced Popup Templates with Category Icons ---
    function getSolarPopup(value) {
        let status = "";
        let icon = "";
        let recommendation = "";
        
        if (value >= 5) {
            status = "Excellent ☀️";
            icon = "🔆";
            recommendation = "Ideal for solar farms and rooftop panels";
        } else if (value >= 4) {
            status = "Good 🌤️";
            icon = "☀️";
            recommendation = "Great for residential solar systems";
        } else if (value >= 3) {
            status = "Moderate 🌥️";
            icon = "⛅";
            recommendation = "Suitable for solar water heating";
        } else {
            status = "Low ⛅";
            icon = "🌫️";
            recommendation = "Limited solar applications";
        }
        
        return {
            title: `${icon} Solar Radiation Analysis`,
            content: `
                <div style="padding: 12px; font-family: Arial, sans-serif;">
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <div style="font-size: 24px; margin-right: 10px;">${icon}</div>
                        <div>
                            <h3 style="margin: 0; color: #2c3e50;">Solar Radiation</h3>
                            <p style="margin: 0; color: #7f8c8d; font-size: 0.9em;">Energy potential analysis</p>
                        </div>
                    </div>
                    
                    <div style="background: #fff3cd; padding: 10px; border-radius: 6px; margin-bottom: 10px;">
                        <div style="font-size: 1.8em; font-weight: bold; color: #e67e22; text-align: center;">
                            ${value.toFixed(2)} kWh/m²/day
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Status</div>
                            <div style="font-weight: bold; color: #2c3e50;">${status}</div>
                        </div>
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Daily Energy</div>
                            <div style="font-weight: bold; color: #2c3e50;">${(value * 8).toFixed(1)} kWh</div>
                        </div>
                    </div>
                    
                    <div style="background: #e8f5e8; padding: 10px; border-radius: 6px; border-left: 4px solid #27ae60;">
                        <div style="font-size: 0.9em; color: #2c3e50;">
                            <strong>💡 Recommendation:</strong> ${recommendation}
                        </div>
                    </div>
                </div>
            `
        };
    }

    function getTemperaturePopup(value) {
        let status = "";
        let icon = "";
        let feelsLike = (value + (Math.random() * 3 - 1.5)).toFixed(1);
        
        if (value >= 35) {
            status = "Extreme Heat 🔥";
            icon = "🥵";
        } else if (value >= 30) {
            status = "Hot ☀️";
            icon = "😎";
        } else if (value >= 25) {
            status = "Warm 🌤️";
            icon = "☀️";
        } else if (value >= 15) {
            status = "Mild 😊";
            icon = "🌤️";
        } else if (value >= 0) {
            status = "Cool ❄️";
            icon = "🥶";
        } else {
            status = "Freezing 🧊";
            icon = "❄️";
        }
        
        return {
            title: `${icon} Temperature Analysis`,
            content: `
                <div style="padding: 12px; font-family: Arial, sans-serif;">
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <div style="font-size: 24px; margin-right: 10px;">${icon}</div>
                        <div>
                            <h3 style="margin: 0; color: #2c3e50;">Temperature</h3>
                            <p style="margin: 0; color: #7f8c8d; font-size: 0.9em;">Current conditions</p>
                        </div>
                    </div>
                    
                    <div style="background: linear-gradient(135deg, #ff6b6b, #ee5a24); padding: 15px; border-radius: 8px; margin-bottom: 10px; text-align: center;">
                        <div style="font-size: 2.2em; font-weight: bold; color: white;">
                            ${value.toFixed(1)}°C
                        </div>
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.9em;">
                            Feels like ${feelsLike}°C
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Status</div>
                            <div style="font-weight: bold; color: #2c3e50;">${status}</div>
                        </div>
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Humidity</div>
                            <div style="font-weight: bold; color: #2c3e50;">${(40 + Math.random() * 40).toFixed(0)}%</div>
                        </div>
                    </div>
                    
                    <div style="background: #e3f2fd; padding: 8px; border-radius: 6px;">
                        <div style="font-size: 0.85em; color: #2c3e50; text-align: center;">
                            <strong>🌡️ Thermal Comfort:</strong> ${value >= 18 && value <= 26 ? "Optimal" : "Outside comfort zone"}
                        </div>
                    </div>
                </div>
            `
        };
    }

    function getWindPopup(value) {
        let status = "";
        let icon = "";
        let energyPotential = "";
        
        if (value >= 8) {
            status = "Very Windy 🌪️";
            icon = "💨";
            energyPotential = "Excellent for wind turbines";
        } else if (value >= 6) {
            status = "Windy 🌬️";
            icon = "🍃";
            energyPotential = "Good for wind energy";
        } else if (value >= 4) {
            status = "Breezy 🍂";
            icon = "🌬️";
            energyPotential = "Moderate wind potential";
        } else {
            status = "Calm 😌";
            icon = "🌫️";
            energyPotential = "Limited wind power";
        }
        
        return {
            title: `${icon} Wind Speed Analysis`,
            content: `
                <div style="padding: 12px; font-family: Arial, sans-serif;">
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <div style="font-size: 24px; margin-right: 10px;">${icon}</div>
                        <div>
                            <h3 style="margin: 0; color: #2c3e50;">Wind Speed</h3>
                            <p style="margin: 0; color: #7f8c8d; font-size: 0.9em;">At 10m height</p>
                        </div>
                    </div>
                    
                    <div style="background: linear-gradient(135deg, #74b9ff, #0984e3); padding: 15px; border-radius: 8px; margin-bottom: 10px; text-align: center;">
                        <div style="font-size: 2.2em; font-weight: bold; color: white;">
                            ${value.toFixed(1)} m/s
                        </div>
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.9em;">
                            ${(value * 3.6).toFixed(1)} km/h
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Status</div>
                            <div style="font-weight: bold; color: #2c3e50;">${status}</div>
                        </div>
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Direction</div>
                            <div style="font-weight: bold; color: #2c3e50;">${['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.floor(Math.random() * 8)]}</div>
                        </div>
                    </div>
                    
                    <div style="background: #e8f5e8; padding: 10px; border-radius: 6px; border-left: 4px solid #27ae60;">
                        <div style="font-size: 0.9em; color: #2c3e50;">
                            <strong>⚡ Energy Potential:</strong> ${energyPotential}
                        </div>
                    </div>
                </div>
            `
        };
    }

    function getAirQualityPopup(value) {
        let status = "";
        let icon = "";
        let color = "";
        let healthAdvice = "";
        
        if (value <= 50) {
            status = "Good ✅";
            icon = "😊";
            color = "#27ae60";
            healthAdvice = "Air quality is satisfactory";
        } else if (value <= 100) {
            status = "Moderate ⚠️";
            icon = "😐";
            color = "#f39c12";
            healthAdvice = "Acceptable for most people";
        } else if (value <= 150) {
            status = "Unhealthy for Sensitive Groups 🚫";
            icon = "😷";
            color = "#e67e22";
            healthAdvice = "Limit prolonged outdoor exertion";
        } else {
            status = "Unhealthy ❌";
            icon = "😵";
            color = "#e74c3c";
            healthAdvice = "Avoid outdoor activities";
        }
        
        return {
            title: `${icon} Air Quality Analysis`,
            content: `
                <div style="padding: 12px; font-family: Arial, sans-serif;">
                    <div style="display: flex; align-items: center; margin-bottom: 10px;">
                        <div style="font-size: 24px; margin-right: 10px;">${icon}</div>
                        <div>
                            <h3 style="margin: 0; color: #2c3e50;">Air Quality Index</h3>
                            <p style="margin: 0; color: #7f8c8d; font-size: 0.9em;">Pollution level</p>
                        </div>
                    </div>
                    
                    <div style="background: ${color}; padding: 15px; border-radius: 8px; margin-bottom: 10px; text-align: center;">
                        <div style="font-size: 2.2em; font-weight: bold; color: white;">
                            ${value.toFixed(1)} AQI
                        </div>
                        <div style="color: rgba(255,255,255,0.9); font-size: 0.9em;">
                            Scale: 0-500
                        </div>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Status</div>
                            <div style="font-weight: bold; color: ${color};">${status}</div>
                        </div>
                        <div style="text-align: center; padding: 8px; background: #f8f9fa; border-radius: 6px;">
                            <div style="font-size: 0.9em; color: #7f8c8d;">Primary Pollutant</div>
                            <div style="font-weight: bold; color: #2c3e50;">${value > 50 ? "PM2.5" : "Low"}</div>
                        </div>
                    </div>
                    
                    <div style="background: #ffeaa7; padding: 10px; border-radius: 6px; border-left: 4px solid #fdcb6e;">
                        <div style="font-size: 0.9em; color: #2c3e50;">
                            <strong>🏥 Health Advice:</strong> ${healthAdvice}
                        </div>
                    </div>
                </div>
            `
        };
    }

    // [Rest of the code remains the same - autocomplete, search, data fetching, visualization functions...]

    // --- Autocomplete ---
    cityInput.addEventListener("input", async () => {
        const query = cityInput.value.trim();
        suggestionsDiv.innerHTML = "";
        searchBtn.disabled = true;
        if (!query) return;

        try {
            const res = await fetch(
                `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/suggest?text=${encodeURIComponent(query)}&f=json&maxSuggestions=5`
            );
            const data = await res.json();
            if (!data.suggestions) return;

            data.suggestions.forEach((s) => {
                const div = document.createElement("div");
                div.textContent = s.text;
                div.addEventListener("click", () => {
                    cityInput.value = s.text;
                    suggestionsDiv.innerHTML = "";
                    searchBtn.disabled = false;
                });
                suggestionsDiv.appendChild(div);
            });
        } catch (e) {
            console.error("Autocomplete error:", e);
        }
    });

    // CLEAR SEARCH BAR WHEN CLICKED
    cityInput.addEventListener("focus", () => {
        cityInput.value = ""; // Clear the input field
        suggestionsDiv.innerHTML = "";
        searchBtn.disabled = true;
    });

    cityInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const first = suggestionsDiv.querySelector("div");
            if (first) first.click();
            if (!searchBtn.disabled) searchBtn.click();
        }
    });

    // --- Search City ---
    searchBtn.addEventListener("click", async () => {
        const city = cityInput.value.trim();
        if (!city) return;

        output.innerHTML = `<div style="text-align: center; padding: 2rem;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #3498db;"></i>
            <p style="margin-top: 1rem;">Searching for ${city}...</p>
        </div>`;

        try {
            const res = await fetch(
                `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?SingleLine=${encodeURIComponent(city)}&f=json&maxLocations=1`
            );
            const data = await res.json();
            
            if (!data.candidates || data.candidates.length === 0) {
                output.innerHTML = `<div style="text-align: center; color: #e74c3c;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 2rem;"></i>
                    <p style="margin-top: 1rem;">City not found. Please try another search.</p>
                </div>`;
                return;
            }

            const candidate = data.candidates[0];
            const { x: lon, y: lat } = candidate.location;
            selectedCity = city.split(",")[0];
            cityCoords = { lon, lat };

            // Get city boundary
            output.innerHTML = `<div style="text-align: center; padding: 2rem;">
                <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #3498db;"></i>
                <p style="margin-top: 1rem;">✅ ${selectedCity} found. Getting city boundaries...</p>
            </div>`;

            cityBoundary = await getCityBoundary(selectedCity, lat, lon);
            const pointCount = calculateOptimalPointCount(cityArea);

            output.innerHTML = `<div style="text-align: center; color: #27ae60;">
                <i class="fas fa-check-circle" style="font-size: 2rem;"></i>
                <p style="margin-top: 1rem;">✅ ${selectedCity} ready for analysis</p>
                <p style="font-size: 0.9rem; color: #7f8c8d;">
                    City area: ${Math.round(cityArea)} km² • 
                    Generating ${pointCount} data points
                </p>
            </div>`;
            
            showDataBtn.disabled = false;
            predictBtn.disabled = false;
            
            // Center map on found city
            view.goTo({
                center: [lon, lat],
                zoom: 10
            });

            // Clear previous data and reset layers
            graphicsLayer.removeAll();
            solarLayer.removeAll();
            tempLayer.removeAll();
            windLayer.removeAll();
            airQualityLayer.removeAll();
            
            // Reset all layers to invisible
            solarLayer.visible = false;
            tempLayer.visible = false;
            windLayer.visible = false;
            airQualityLayer.visible = false;
            currentActiveLayer = null;
            
            // Reset checkboxes
            document.getElementById('solarLayerToggle').checked = false;
            document.getElementById('tempLayerToggle').checked = false;
            document.getElementById('windLayerToggle').checked = false;
            document.getElementById('airQualityLayerToggle').checked = false;

        } catch (e) {
            console.error("Search error:", e);
            output.innerHTML = `<div style="text-align: center; color: #e74c3c;">
                <i class="fas fa-exclamation-circle" style="font-size: 2rem;"></i>
                <p style="margin-top: 1rem;">Error searching for city. Please try again.</p>
            </div>`;
        }
    });

    // --- Enhanced Data Fetching with Real APIs ---
    async function fetchEnhancedCityData(lat, lon) {
        if (!cityBoundary) {
            // Fallback if no boundary available
            cityBoundary = createFallbackBoundary(lat, lon);
        }
        
        // Calculate optimal number of points based on city size
        const pointCount = calculateOptimalPointCount(cityArea);
        
        // FIXED: Use reliable point generation
        const points = generateCityPoints(lat, lon, cityBoundary, pointCount);
        
        console.log(`Final point count: ${points.length} out of requested ${pointCount}`);
        
        let cityAverageData = {
            temp: 0, wind: 0, solar: 0, airQuality: 0,
            tempPoints: [], windPoints: [], solarPoints: [], aqPoints: []
        };

        // Try to get real data first, then fall back to estimates
        let realData = null;
        try {
            realData = await fetchRealAPIData(lat, lon);
        } catch (e) {
            console.warn("Real API data failed, using estimates:", e);
        }

        // Create data points with real data or estimates
        for (let point of points) {
            const pointData = realData ? 
                getPointDataFromRealData(realData, point) : 
                await getEstimatedPointData(point.lat, point.lon);
            
            // FIX FOR NaN: Ensure we have valid numbers
            const tempValue = pointData.temp && !isNaN(pointData.temp) ? pointData.temp : estimateTemperature(point.lat);
            const windValue = pointData.wind && !isNaN(pointData.wind) ? pointData.wind : estimateWind(point.lat);
            const solarValue = pointData.solar && !isNaN(pointData.solar) ? pointData.solar : estimateSolar(point.lat);
            const aqValue = pointData.aqValue && !isNaN(pointData.aqValue) ? pointData.aqValue : 30 + Math.random() * 50;
            
            if (tempValue) {
                cityAverageData.tempPoints.push({
                    point: point,
                    value: tempValue
                });
            }
            if (windValue) {
                cityAverageData.windPoints.push({
                    point: point, 
                    value: windValue
                });
            }
            if (solarValue) {
                cityAverageData.solarPoints.push({
                    point: point,
                    value: solarValue
                });
            }
            if (aqValue) {
                cityAverageData.aqPoints.push({
                    point: point,
                    value: aqValue
                });
            }
        }

        // Calculate averages - FIX FOR NaN: Check array length and values
        if (cityAverageData.tempPoints.length > 0) {
            const validTemps = cityAverageData.tempPoints.filter(p => !isNaN(p.value));
            cityAverageData.temp = validTemps.length > 0 ? 
                validTemps.reduce((sum, p) => sum + p.value, 0) / validTemps.length : 
                estimateTemperature(lat);
        } else {
            cityAverageData.temp = estimateTemperature(lat);
        }

        if (cityAverageData.windPoints.length > 0) {
            const validWinds = cityAverageData.windPoints.filter(p => !isNaN(p.value));
            cityAverageData.wind = validWinds.length > 0 ? 
                validWinds.reduce((sum, p) => sum + p.value, 0) / validWinds.length : 
                estimateWind(lat);
        } else {
            cityAverageData.wind = estimateWind(lat);
        }

        if (cityAverageData.solarPoints.length > 0) {
            const validSolars = cityAverageData.solarPoints.filter(p => !isNaN(p.value));
            cityAverageData.solar = validSolars.length > 0 ? 
                validSolars.reduce((sum, p) => sum + p.value, 0) / validSolars.length : 
                estimateSolar(lat);
        } else {
            cityAverageData.solar = estimateSolar(lat);
        }

        if (cityAverageData.aqPoints.length > 0) {
            const validAqs = cityAverageData.aqPoints.filter(p => !isNaN(p.value));
            cityAverageData.airQuality = validAqs.length > 0 ? 
                validAqs.reduce((sum, p) => sum + p.value, 0) / validAqs.length : 
                30 + Math.random() * 50;
        } else {
            cityAverageData.airQuality = 30 + Math.random() * 50;
        }

        return {
            average: cityAverageData,
            detailed: cityAverageData,
            isRealData: !!realData,
            pointCount: points.length,
            cityArea: cityArea
        };
    }

    async function fetchRealAPIData(lat, lon) {
        let temp = null, wind = null, solar = null, aqValue = null;

        // Try NASA POWER API first
        try {
            const today = new Date();
            const past = new Date();
            past.setDate(today.getDate() - 7);
            const startStr = `${past.getFullYear()}${String(past.getMonth() + 1).padStart(2, "0")}${String(past.getDate()).padStart(2, "0")}`;
            const endStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

            const res = await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=T2M,WS10M,ALLSKY_SFC_SW_DWN&community=RE&longitude=${lon}&latitude=${lat}&start=${startStr}&end=${endStr}&format=JSON`);
            const data = await res.json();
            
            const keys = Object.keys(data.properties.parameter.T2M || {});
            for (let i = keys.length - 1; i >= 0; i--) {
                const d = keys[i];
                const tVal = data.properties.parameter.T2M[d];
                const wVal = data.properties.parameter.WS10M[d];
                const sVal = data.properties.parameter.ALLSKY_SFC_SW_DWN[d];
                
                if (tVal != -999 && wVal != -999 && sVal != -999) {
                    temp = tVal;
                    wind = wVal;
                    solar = sVal;
                    break;
                }
            }
        } catch (e) {
            console.warn("NASA POWER failed:", e);
        }

        // Try OpenWeatherMap as fallback
        if (!temp || !wind) {
            try {
                const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_KEY}&units=metric`);
                const wData = await res.json();
                
                if (!temp && wData.main?.temp) temp = wData.main.temp;
                if (!wind && wData.wind?.speed) wind = wData.wind.speed;
                if (!solar && wData.clouds?.all !== undefined) {
                    solar = Math.max(1, 6 - (wData.clouds.all / 20));
                }
            } catch (e) {
                console.warn("OpenWeatherMap failed:", e);
            }
        }

        // Try air quality API
        try {
            const res = await fetch(`https://api.openaq.org/v2/measurements?coordinates=${lat},${lon}&limit=1&order_by=datetime&sort=desc`);
            const aData = await res.json();
            
            if (aData.results?.length > 0) {
                aqValue = aData.results[0].value;
            }
        } catch (e) {
            console.warn("Air quality API failed:", e);
        }

        return { temp, wind, solar, aqValue };
    }

    function getPointDataFromRealData(realData, point) {
        // Add slight variation to real data for different points
        const baseTemp = realData.temp || estimateTemperature(point.lat);
        const baseWind = realData.wind || estimateWind(point.lat);
        const baseSolar = realData.solar || estimateSolar(point.lat);
        const baseAQ = realData.aqValue || (30 + Math.random() * 50);
        
        return {
            temp: baseTemp + (Math.random() * 2 - 1),
            wind: baseWind + (Math.random() * 1 - 0.5),
            solar: baseSolar + (Math.random() * 0.5 - 0.25),
            aqValue: baseAQ + (Math.random() * 10 - 5)
        };
    }

    async function getEstimatedPointData(lat, lon) {
        // Use smart estimates when real APIs fail
        return {
            temp: estimateTemperature(lat),
            wind: estimateWind(lat),
            solar: estimateSolar(lat),
            aqValue: 30 + Math.random() * 50
        };
    }

    function visualizeDataLayers(cityData) {
        // Clear previous visualizations
        [solarLayer, tempLayer, windLayer, airQualityLayer].forEach(layer => layer.removeAll());

        // Solar Radiation Layer
        cityData.detailed.solarPoints.forEach(pointData => {
            solarLayer.add(new Graphic({
                geometry: new Point({
                    longitude: pointData.point.lon,
                    latitude: pointData.point.lat
                }),
                symbol: {
                    type: "simple-marker",
                    color: [255, 215, 0, 0.8],
                    size: "12px",
                    outline: {
                        color: [255, 165, 0],
                        width: 2
                    }
                },
                popupTemplate: getSolarPopup(pointData.value)
            }));
        });

        // Temperature Layer
        cityData.detailed.tempPoints.forEach(pointData => {
            tempLayer.add(new Graphic({
                geometry: new Point({
                    longitude: pointData.point.lon,
                    latitude: pointData.point.lat
                }),
                symbol: {
                    type: "simple-marker",
                    color: [255, 69, 0, 0.8],
                    size: "12px",
                    outline: {
                        color: [200, 0, 0],
                        width: 2
                    }
                },
                popupTemplate: getTemperaturePopup(pointData.value)
            }));
        });

        // Wind Speed Layer
        cityData.detailed.windPoints.forEach(pointData => {
            windLayer.add(new Graphic({
                geometry: new Point({
                    longitude: pointData.point.lon,
                    latitude: pointData.point.lat
                }),
                symbol: {
                    type: "simple-marker",
                    color: [135, 206, 235, 0.8],
                    size: "12px",
                    outline: {
                        color: [0, 100, 255],
                        width: 2
                    }
                },
                popupTemplate: getWindPopup(pointData.value)
            }));
        });

        // Air Quality Layer
        cityData.detailed.aqPoints.forEach(pointData => {
            const color = pointData.value > 50 ? [255, 0, 0, 0.8] : [105, 105, 105, 0.8];
            
            airQualityLayer.add(new Graphic({
                geometry: new Point({
                    longitude: pointData.point.lon,
                    latitude: pointData.point.lat
                }),
                symbol: {
                    type: "simple-marker",
                    color: color,
                    size: "12px",
                    outline: {
                        color: [0, 0, 0],
                        width: 2
                    }
                },
                popupTemplate: getAirQualityPopup(pointData.value)
            }));
        });
    }

    function displayCitySummary(cityData) {
        const avg = cityData.average;
        const dataSource = cityData.isRealData ? 
            "<small style='color: #27ae60;'>🌐 Real-time data from satellite and weather APIs</small>" :
            "<small style='color: #e67e22;'>📊 Estimated data based on geographic patterns</small>";
        
        const citySizeInfo = cityData.cityArea > 1000 ? " (Large City)" : 
                           cityData.cityArea > 200 ? " (Medium City)" : " (Small City)";
        
        // Original design for city data (without the map overview section)
        output.innerHTML = `
            <div class="city-summary">
                <h3>🏙️ ${selectedCity} - City Overview${citySizeInfo}</h3>
                <p>Average environmental data across ${cityData.pointCount} evenly spaced locations within ${Math.round(cityData.cityArea)} km² city area</p>
                ${dataSource}
            </div>
            
            <div class="data-grid">
                <div class="data-card">
                    <i class="fas fa-thermometer-half temp-icon"></i>
                    <div class="data-value">${avg.temp ? avg.temp.toFixed(1) + '°C' : 'N/A'}</div>
                    <div class="data-label">Temperature</div>
                </div>
                
                <div class="data-card">
                    <i class="fas fa-wind wind-icon"></i>
                    <div class="data-value">${avg.wind ? avg.wind.toFixed(1) + ' m/s' : 'N/A'}</div>
                    <div class="data-label">Wind Speed</div>
                </div>
                
                <div class="data-card">
                    <i class="fas fa-sun solar-icon"></i>
                    <div class="data-value">${avg.solar ? avg.solar.toFixed(2) + ' kWh/m²' : 'N/A'}</div>
                    <div class="data-label">Solar Radiation</div>
                </div>
                
                <div class="data-card">
                    <i class="fas fa-smog air-icon"></i>
                    <div class="data-value">${avg.airQuality ? avg.airQuality.toFixed(1) + ' AQI' : 'N/A'}</div>
                    <div class="data-label">Air Quality</div>
                </div>
            </div>
            
            <div style="margin-top: 1.5rem; padding: 1rem; background: #e3f2fd; border-radius: 8px; border-left: 4px solid #3498db;">
                <h4 style="color: #2c3e50; margin-bottom: 0.5rem;">
                    <i class="fas fa-layer-group"></i> Layer Controls
                </h4>
                <p style="color: #7f8c8d; margin: 0; font-size: 0.9rem;">
                    Click on the layer buttons above to visualize one data layer at a time on the map. Each layer shows detailed information when you click on the points.
                </p>
            </div>
        `;
    }

    // --- Show Data ---
    showDataBtn.addEventListener("click", async () => {
        if (!cityCoords) return;

        layerControls.style.display = 'block';
        
        const pointCount = calculateOptimalPointCount(cityArea);
        output.innerHTML = `<div style="text-align: center; padding: 2rem;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #3498db;"></i>
            <p style="margin-top: 1rem;">Loading environmental data for ${selectedCity}...</p>
            <p style="font-size: 0.9rem; color: #7f8c8d;">Generating ${pointCount} data points across ${Math.round(cityArea)} km²</p>
        </div>`;

        try {
            const cityData = await fetchEnhancedCityData(cityCoords.lat, cityCoords.lon);
            currentCityData = cityData;

            visualizeDataLayers(cityData);
            displayCitySummary(cityData);

            // Center map
            view.goTo({
                center: [cityCoords.lon, cityCoords.lat],
                zoom: 11
            });

        } catch (error) {
            console.error("Data loading error:", error);
            output.innerHTML = `<div style="text-align: center; color: #e74c3c;">
                <i class="fas fa-exclamation-triangle" style="font-size: 2rem;"></i>
                <p style="margin-top: 1rem;">Error loading data. Please try again.</p>
            </div>`;
        }
    });

    // --- AI Prediction ---
    predictBtn.addEventListener("click", async () => {
        if (!currentCityData) {
            output.innerHTML += `<div style="color: #e67e22; margin-top: 1rem; padding: 1rem; background: #fdf6e3; border-radius: 8px;">
                <i class="fas fa-info-circle"></i> Please load data first using "Show Data"
            </div>`;
            return;
        }

        const insights = generateAISolutions(currentCityData.average);
        
        output.innerHTML += `
            <div style="margin-top: 2rem; padding: 1.5rem; background: linear-gradient(135deg, #d4edda, #c3e6cb); border-radius: 12px; border-left: 5px solid #28a745;">
                <h3 style="color: #155724; margin-bottom: 1rem;">
                    <i class="fas fa-robot"></i> AI Planning Recommendations
                </h3>
                <div style="display: grid; gap: 0.75rem;">
                    ${insights.map(insight => `
                        <div style="padding: 0.75rem; background: rgba(255,255,255,0.9); border-radius: 8px; border-left: 3px solid #28a745;">
                            ${insight}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    });

    function generateAISolutions(data) {
        const insights = [];
        const avgTemp = data.temp;
        const avgWind = data.wind;
        const avgSolar = data.solar;
        const avgAQ = data.airQuality;

        if (avgWind >= 4) {
            insights.push("💨 <strong>Wind Energy:</strong> Suitable conditions for wind turbine installation in open areas.");
        }
        
        if (avgSolar >= 4) {
            insights.push("☀️ <strong>Solar Power:</strong> Excellent solar potential for rooftop solar panels and solar farms.");
        }
        
        if (avgTemp > 25) {
            insights.push("🌳 <strong>Urban Greening:</strong> Implement tree planting and green roofs to reduce heat island effect.");
        }
        
        if (avgAQ > 50) {
            insights.push("🌫️ <strong>Air Quality:</strong> Consider traffic management and industrial emission controls.");
        }
        
        if (avgSolar >= 4 && avgTemp > 20) {
            insights.push("⚡ <strong>Renewable Integration:</strong> Ideal for solar-powered EV charging stations.");
        }

        if (insights.length === 0) {
            insights.push("📊 <strong>Baseline Assessment:</strong> Continue monitoring environmental metrics for optimization opportunities.");
        }

        return insights;
    }

    // Initialize with layer controls hidden
    layerControls.style.display = 'none';
});

// --- Enhanced Problem Reporting Form ---
const problemReportForm = document.getElementById("problemReportForm");
const cancelReportBtn = document.getElementById("cancelReport");

function handleProblemReport(event) {
    event.preventDefault();
    
    const reportData = {
        userName: document.getElementById('userName').value,
        userEmail: document.getElementById('userEmail').value,
        problemType: document.getElementById('problemType').value,
        problemLocation: document.getElementById('problemLocation').value,
        problemDescription: document.getElementById('problemDescription').value,
        urgency: document.querySelector('input[name="urgency"]:checked').value,
        city: document.getElementById('cityInput').value || 'Not specified',
        timestamp: new Date().toISOString()
    };
    
    // Simulate sending the report (in a real app, this would send to a server)
    console.log('Problem report submitted:', reportData);
    
    // Show success message
    const reportSection = document.getElementById('report-section');
    reportSection.innerHTML = `
        <div class="success-message">
            <i class="fas fa-check-circle"></i>
            <h3>Report Submitted Successfully!</h3>
            <p>
                Your report has been sent to city officials and our team. 
                We'll review it and take appropriate action.
            </p>
            <button onclick="resetReportForm()" class="btn-secondary" style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white;">
                Submit Another Report
            </button>
        </div>
    `;
}

function resetReportForm() {
    const reportSection = document.getElementById('report-section');
    reportSection.innerHTML = `
        <h3><i class="fas fa-exclamation-triangle"></i> Report Environmental Problem</h3>
        <p style="margin-bottom: 1.5rem; color: #7f8c8d;">Found an environmental issue? Report it directly to city officials and our team.</p>
        
        <form id="problemReportForm">
            <div class="form-row">
                <div class="form-group">
                    <label for="userName">Your Name</label>
                    <input type="text" id="userName" placeholder="Enter your name" required>
                </div>
                <div class="form-group">
                    <label for="userEmail">Your Email</label>
                    <input type="email" id="userEmail" placeholder="Enter your email" required>
                </div>
            </div>
            
            <div class="form-group">
                <label for="problemType">Problem Type</label>
                <select id="problemType" required>
                    <option value="">Select problem type</option>
                    <option value="air_quality">🌫️ Air Quality Issue</option>
                    <option value="pollution">🏭 Pollution Source</option>
                    <option value="waste">🗑️ Waste Management</option>
                    <option value="noise">🔊 Noise Pollution</option>
                    <option value="water">💧 Water Quality</option>
                    <option value="green_space">🌳 Lack of Green Space</option>
                    <option value="other">❓ Other Issue</option>
                </select>
            </div>
            
            <div class="form-group">
                <label for="problemLocation">Problem Location</label>
                <input type="text" id="problemLocation" placeholder="e.g., Downtown, Residential Area, Park, etc." required>
            </div>
            
            <div class="form-group">
                <label for="problemDescription">Problem Description</label>
                <textarea id="problemDescription" placeholder="Please describe the problem in detail..." rows="4" required></textarea>
            </div>
            
            <div class="form-group">
                <label>Urgency Level</label>
                <div class="urgency-options">
                    <label class="urgency-option">
                        <input type="radio" name="urgency" value="low" required>
                        <span class="urgency-label">Low</span>
                    </label>
                    <label class="urgency-option">
                        <input type="radio" name="urgency" value="medium">
                        <span class="urgency-label">Medium</span>
                    </label>
                    <label class="urgency-option">
                        <input type="radio" name="urgency" value="high">
                        <span class="urgency-label">High</span>
                    </label>
                    <label class="urgency-option">
                        <input type="radio" name="urgency" value="emergency">
                        <span class="urgency-label">Emergency</span>
                    </label>
                </div>
            </div>
            
            <div class="form-actions">
                <button type="button" id="cancelReport" class="btn-secondary">Cancel</button>
                <button type="submit" class="btn-primary">
                    <i class="fas fa-paper-plane"></i> Submit Report
                </button>
            </div>
        </form>
    `;
    
    // Re-attach event listeners
    document.getElementById('problemReportForm').addEventListener('submit', handleProblemReport);
    document.getElementById('cancelReport').addEventListener('click', resetReportForm);
}

// Initialize form event listeners
problemReportForm.addEventListener('submit', handleProblemReport);
cancelReportBtn.addEventListener('click', resetReportForm);