# BTAP Surrogate Model - Frontend

A simple, user-friendly web interface for the BTAP (Building Technology Assessment Platform) Surrogate Model energy prediction system.

## Overview

This frontend provides an intuitive form-based interface where users can configure building parameters through dropdown menus instead of manually creating Excel files. The application automatically generates the required input file and sends it to the backend API for energy predictions.

## Features

- ✅ **User-Friendly Interface**: Clean, modern design with organized sections
- ✅ **Dropdown Menus**: All building parameters accessible through select boxes
- ✅ **Tooltips**: Helpful information for each parameter
- ✅ **Real-time Validation**: Form validation ensures all required fields are filled
- ✅ **Automatic File Generation**: Creates the required CSV/Excel format from form inputs
- ✅ **Results Display**: Shows energy predictions in an easy-to-read format
- ✅ **Loading Indicators**: Visual feedback during API calls
- ✅ **Responsive Design**: Works on desktop, tablet, and mobile devices

## Building Parameters

The form collects the following building configuration parameters:

### HVAC System Configuration
- **Dominant HVAC System**: Heat pump systems, baseline configurations
- **Primary Heating Fuel**: Electricity, Natural Gas, Fuel Oil, Heat Pump
- **Boiler Efficiency**: Standard, 88%, or 96.2% efficient models
- **Furnace Efficiency**: Standard or 85% condensing
- **Service Hot Water Efficiency**: Direct vent or power vent systems

### Ventilation Configuration
- **Demand Control Ventilation (DCV)**: Occupancy-based, CO2-based, or none
- **Energy Recovery Ventilator (ERV)**: Plate or rotary heat exchangers
- **Economizer Type**: Differential dry bulb or enthalpy control
- **Natural Ventilation**: Enable or disable natural ventilation

### Building Envelope
- **External Wall Conductance**: Insulation level (0.183 - 0.314 W/m²·K)
- **External Roof Conductance**: Insulation level (0.121 - 0.227 W/m²·K)
- **Window Conductance**: Single, double, or triple glazing (1.6 - 2.4 W/m²·K)
- **Window Solar Heat Gain Coefficient (SHGC)**: 0.2 to 0.6
- **Fenestration to Wall Ratio (FDWR)**: 10% to 69%
- **Skylight to Roof Ratio (SRR)**: 0% to 10%

### Building Configuration
- **Building Type**: Midrise Apartment (more types can be added)
- **Rotation**: Building orientation (0°-359°)
- **Weather Location**: Toronto (more locations can be added)
- **PV Solar Panels**: Ground-mounted photovoltaic configuration

## Usage

### Local Development

1. **Open the application**:
   Simply open `index.html` in a web browser:
   ```bash
   # On Windows
   start index.html
   
   # On Mac
   open index.html
   
   # On Linux
   xdg-open index.html
   ```

2. **Or use a local server** (recommended):
   ```bash
   # Using Python
   python -m http.server 8080
   
   # Using Node.js http-server
   npx http-server -p 8080
   ```
   Then navigate to `http://localhost:8080`

### Using the Application

1. **Fill out the form**:
   - Select values from dropdown menus for each building parameter
   - Hover over the ℹ️ icons for parameter descriptions
   - All fields are required

2. **Generate Prediction**:
   - Click "🚀 Generate Prediction" button
   - The app will create a CSV file from your inputs
   - Upload it to the API
   - Display the energy prediction results

3. **View Results**:
   - Results show key energy metrics:
     - Total Energy Use Intensity (EUI)
     - Electricity and Natural Gas consumption
     - Heating and Cooling loads
     - Peak electric demand
     - Equipment costs
     - GHG emissions

4. **Reset Form**:
   - Click "🔄 Reset Form" to clear all selections and start over

## API Configuration

The frontend connects to the deployed API at:
```
https://jv9uk86ooc.execute-api.ca-central-1.amazonaws.com
```

To change the API endpoint, edit `app.js`:
```javascript
const API_BASE_URL = 'https://your-api-gateway-url.amazonaws.com';
```

## File Structure

```
Frontend/
├── index.html          # Main HTML file with form structure
├── styles.css          # CSS styling and responsive design
├── app.js             # JavaScript for form handling and API calls
└── README.md          # This file
```

## How It Works

1. **User Input**: User selects building parameters from dropdown menus
2. **File Generation**: JavaScript creates a CSV file with all required columns:
   - User-selected values for the 19 key parameters
   - Default "NECB_Default" values for all other columns
3. **API Upload**: File is uploaded to `/upload` endpoint
4. **Prediction Request**: Task ID is sent to `/run-model-s3` endpoint
5. **Results Display**: Energy predictions are formatted and displayed

## Default Values

All non-user-configurable parameters are set to `NECB_Default` which represents:
- NECB 2020 building code compliance
- Standard Canadian building practices
- Baseline energy performance

These defaults ensure the model can run with minimal user input while still providing meaningful predictions.

## Customization

### Adding More Building Types

Edit `index.html` to add more options to the building type dropdown:
```html
<select id="building_type" name="building_type" required>
    <option value="MidriseApartment">Midrise Apartment</option>
    <option value="HighriseApartment">Highrise Apartment</option>
    <option value="SmallOffice">Small Office</option>
    <!-- Add more types -->
</select>
```

### Adding More Weather Locations

1. Ensure the EPW weather file exists in the backend's `input/weather/` directory
2. Add the location to the dropdown in `index.html`:
```html
<select id="epw_file" name="epw_file" required>
    <option value="CAN_ON_Toronto.Pearson.Intl.AP.716240_CWEC2016.epw">Toronto, ON</option>
    <option value="CAN_BC_Vancouver.Intl.AP.718920_CWEC2016.epw">Vancouver, BC</option>
    <!-- Add more locations -->
</select>
```

### Styling Changes

Modify `styles.css` to change:
- Color scheme (currently purple gradient)
- Layout and spacing
- Responsive breakpoints
- Button styles

## Browser Compatibility

- ✅ Chrome/Edge (recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Mobile browsers

Requires JavaScript enabled.

## Known Limitations

1. **Single Building Type**: Currently only supports Midrise Apartment buildings
2. **Single Location**: Only Toronto weather data available
3. **CSV vs Excel**: Generates CSV format (backend should accept both)
4. **No Authentication**: Direct API access (add authentication if needed)
5. **Result Format**: Assumes specific response structure from API

## Future Enhancements

- [ ] Support for multiple building types
- [ ] Additional weather locations across Canada
- [ ] Excel file generation (instead of CSV)
- [ ] Authentication/authorization
- [ ] Save/load building configurations
- [ ] Compare multiple configurations side-by-side
- [ ] Export results to PDF
- [ ] Visualization charts for energy breakdown
- [ ] Advanced mode with all 201 parameters

## Troubleshooting

### Form not submitting
- Check browser console for JavaScript errors
- Ensure all required fields are filled
- Verify API endpoint is accessible

### API errors
- Check API Gateway URL is correct
- Verify backend is running and healthy
- Check CORS settings on API Gateway
- Review CloudWatch logs for backend errors

### Results not displaying
- Check browser console for errors
- Verify API response format matches expected structure
- Test API endpoints directly using curl or Postman

## Support

For issues or questions:
1. Check the browser console for error messages
2. Verify the backend API is running: `https://your-api-url/health`
3. Review the DEPLOYMENT_GUIDE.md for backend setup
4. Check CloudWatch logs for API errors

---

**Last Updated**: December 15, 2025
