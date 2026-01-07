// Configuration
const API_BASE_URL = 'https://08879hja2c.execute-api.ca-central-1.amazonaws.com/surrogate_model';
const BUCKET_NAME = 'btap-app-test3-dev-tgw-3-btap-v1-uploads';
const AWS_REGION = 'ca-central-1';

// Cognito Configuration
const poolData = {
    UserPoolId: 'ca-central-1_NHVo7D7Kw',
    ClientId: '1bba66drbfqk7rgnq0h13mf56l'
};

// Check authentication on page load
function checkAuthentication() {
    const accessToken = sessionStorage.getItem('accessToken');
    const idToken = sessionStorage.getItem('idToken');
    const userEmail = sessionStorage.getItem('userEmail');
    
    if (!accessToken || !idToken) {
        // Not authenticated, redirect to login
        window.location.href = 'auth.html';
        return false;
    }
    
    // Display user email
    if (userEmail) {
        document.getElementById('user-email').textContent = userEmail;
    }
    
    return true;
}

// Handle logout
function handleLogout() {
    // Clear session storage
    sessionStorage.removeItem('accessToken');
    sessionStorage.removeItem('idToken');
    sessionStorage.removeItem('userEmail');
    
    // Redirect to login page
    window.location.href = 'auth.html';
}

// Get auth token for API requests
function getAuthToken() {
    return sessionStorage.getItem('idToken');
}

// Check auth on page load
if (!checkAuthentication()) {
    // Stop script execution if not authenticated
    throw new Error('Not authenticated');
}

// Form handling
document.getElementById('buildingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form data
    const formData = new FormData(e.target);
    const buildingConfig = {};
    
    for (let [key, value] of formData.entries()) {
        // Skip analysisType and variableParameter, handle them separately
        if (key === 'analysisType' || key === 'variableParameter') {
            continue;
        }
        // Convert numeric strings to numbers
        if (!isNaN(value) && value !== '') {
            buildingConfig[':' + key] = parseFloat(value);
        } else {
            buildingConfig[':' + key] = value;
        }
    }
    
    // Get analysis type
    const analysisType = formData.get('analysisType');
    const variableParameter = formData.get('variableParameter');
    
    console.log('Building Configuration:', buildingConfig);
    console.log('Analysis Type:', analysisType);
    console.log('Variable Parameter:', variableParameter);
    
    // Validate alternative analysis selection
    if (analysisType === 'alternative' && !variableParameter) {
        alert('Please select a parameter to vary for alternative configuration analysis.');
        return;
    }
    
    // Show loading overlay
    showLoading();
    
    try {
        let results;
        
        if (analysisType === 'single') {
            // Generate Excel file from configuration
            const excelBlob = await generateExcelFile(buildingConfig);
            
            // Upload to API
            results = await uploadAndPredict(excelBlob);
            results.analysisType = 'single';
        } else {
            // Alternative configuration analysis
            const excelBlob = await generateMultiConfigExcelFile(buildingConfig, variableParameter);
            
            // Upload to API
            results = await uploadAndPredict(excelBlob);
            results.analysisType = 'alternative';
            results.variableParameter = variableParameter;
        }
        
        // Display results
        displayResults(results);
        
    } catch (error) {
        console.error('Error:', error);
        displayError(error.message);
    } finally {
        hideLoading();
    }
});

// Generate Excel file from building configuration
async function generateExcelFile(config) {
    // Load ALL default values from the first row of the sample Input.xlsx
    let allDefaults;
    try {
        const defaultsResponse = await fetch('./defaults_from_excel.json');
        if (!defaultsResponse.ok) {
            throw new Error(`Failed to load defaults_from_excel.json: ${defaultsResponse.status} ${defaultsResponse.statusText}`);
        }
        allDefaults = await defaultsResponse.json();
    } catch (error) {
        console.error('Error loading defaults:', error);
        throw new Error(`Failed to load configuration defaults: ${error.message}`);
    }
    
    // Create a copy of all defaults
    const row = { ...allDefaults };
    
    console.log('Config received:', config);
    console.log('Config keys:', Object.keys(config));
    
    // Override with user-selected values (the 19 configurable parameters)
    const userParams = [
        'ecm_system_name', 'primary_heating_fuel', 'boiler_eff', 'furnace_eff', 'shw_eff',
        'dcv_type', 'erv_package', 'airloop_economizer_type', 'nv_type',
        'ext_wall_cond', 'ext_roof_cond', 'fixed_window_cond', 'fixed_wind_solar_trans', 'fdwr_set',
        'srr_set', 'building_type', 'rotation_degrees', 'epw_file', 'pv_ground_type'
    ];
    
    let updatedCount = 0;
    userParams.forEach(param => {
        const key = ':' + param;
        if (config[key] !== undefined) {
            console.log(`Updating ${key}: ${allDefaults[key]} -> ${config[key]}`);
            row[key] = config[key];
            updatedCount++;
        }
    });
    
    console.log(`Updated ${updatedCount} out of ${userParams.length} user parameters`);
    console.log('Final values:', userParams.map(p => ':' + p + '=' + row[':' + p]));
    
    // Create worksheet from the data (single row)
    const ws = XLSX.utils.json_to_sheet([row]);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
    // Generate Excel file as binary
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    
    // Convert to Blob
    const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    return blob;
}

// Generate Excel file with multiple configurations for alternative analysis
async function generateMultiConfigExcelFile(config, variableParameter) {
    // Load ALL default values from the first row of the sample Input.xlsx
    let allDefaults;
    try {
        const defaultsResponse = await fetch('./defaults_from_excel.json');
        if (!defaultsResponse.ok) {
            throw new Error(`Failed to load defaults_from_excel.json: ${defaultsResponse.status} ${defaultsResponse.statusText}`);
        }
        allDefaults = await defaultsResponse.json();
    } catch (error) {
        console.error('Error loading defaults:', error);
        throw new Error(`Failed to load configuration defaults: ${error.message}`);
    }
    
    console.log('Generating configurations for parameter:', variableParameter);
    
    // Define the variation values for different parameters based on actual form options
    const parameterVariations = {
        'ext_wall_cond': [0.183, 0.210, 0.247, 0.278, 0.314],
        'ext_roof_cond': [0.121, 0.138, 0.142, 0.162, 0.183, 0.193, 0.227],
        'fixed_window_cond': [1.6, 2.2, 2.4],
        'fixed_wind_solar_trans': [0.2, 0.3, 0.4, 0.5, 0.6],
        'fdwr_set': [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.69],
        'srr_set': ['NECB_Default', 0.03, 0.05, 0.08, 0.1],
        'boiler_eff': [
            'NECB_Default',
            'NECB 88% Efficient Condensing Boiler',
            'Viessmann Vitocrossal 300 CT3-17 96.2% Efficient Condensing Gas Boiler'
        ],
        'furnace_eff': [
            'NECB_Default',
            'NECB 85% Efficient Condensing Gas Furnace'
        ],
        'shw_eff': [
            'NECB_Default',
            'Natural Gas Direct Vent with Electric Ignition',
            'Natural Gas Power Vent with Electric Ignition'
        ]
    };
    
    const variations = parameterVariations[variableParameter];
    if (!variations) {
        throw new Error(`No variations defined for parameter: ${variableParameter}`);
    }
    
    const rows = [];
    const numConfigs = variations.length;
    
    console.log(`Creating ${numConfigs} configurations for ${variableParameter}`);
    
    // Create configurations based on the number of variations available
    for (let i = 0; i < numConfigs; i++) {
        // Create a copy of all defaults
        const row = { ...allDefaults };
        
        // Override with user-selected values (the 19 configurable parameters)
        const userParams = [
            'ecm_system_name', 'primary_heating_fuel', 'boiler_eff', 'furnace_eff', 'shw_eff',
            'dcv_type', 'erv_package', 'airloop_economizer_type', 'nv_type',
            'ext_wall_cond', 'ext_roof_cond', 'fixed_window_cond', 'fixed_wind_solar_trans', 'fdwr_set',
            'srr_set', 'building_type', 'rotation_degrees', 'epw_file', 'pv_ground_type'
        ];
        
        userParams.forEach(param => {
            const key = ':' + param;
            if (config[key] !== undefined) {
                row[key] = config[key];
            }
        });
        
        // Override the variable parameter with the specific variation value
        const variableKey = ':' + variableParameter;
        row[variableKey] = variations[i];
        
        console.log(`Configuration ${i + 1}: ${variableParameter} = ${variations[i]}`);
        
        rows.push(row);
    }
    
    // Create worksheet from the data (5 rows)
    const ws = XLSX.utils.json_to_sheet(rows);
    
    // Create workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    
    // Generate Excel file as binary
    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    
    // Convert to Blob
    const blob = new Blob([excelBuffer], { 
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    
    return blob;
}

// Upload file and get prediction
async function uploadAndPredict(fileBlob) {
    // Generate unique email with timestamp to avoid caching issues
    const uniqueEmail = 'frontend_user_' + Date.now();
    console.log('Using unique email:', uniqueEmail);
    
    // Create FormData for upload
    const uploadFormData = new FormData();
    uploadFormData.append('file', fileBlob, 'building_config.xlsx');
    uploadFormData.append('email', uniqueEmail);
    
    // Upload file
    let uploadResponse;
    try {
        uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: uploadFormData
        });
    } catch (error) {
        console.error('Network error during upload:', error);
        throw new Error(`Network error during file upload: ${error.message}. Please check your internet connection.`);
    }
    
    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Upload failed: ${errorText}`);
    }
    
    const uploadResult = await uploadResponse.json();
    console.log('Upload result:', uploadResult);
    
    // Run model with the uploaded file
    // The config_file parameter should be the YAML config file path
    const predictFormData = new FormData();
    predictFormData.append('email', uniqueEmail);
    predictFormData.append('config_file', 'input_config.yml');
    
    const predictResponse = await fetch(`${API_BASE_URL}/run-model-s3`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getAuthToken()}`
        },
        body: predictFormData
    });
    
    if (!predictResponse.ok) {
        const errorText = await predictResponse.text();
        throw new Error(`Prediction failed: ${errorText}`);
    }
    
    const results = await predictResponse.json();
    console.log('Prediction results:', results);
    console.log('Output key:', results.output_key);
    console.log('Expected S3 path: uploads/' + uniqueEmail + '_output.json');
    
    // Wait a moment for S3 to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Download the actual results from S3
    if (results.status === 'success' && results.output_key) {
        const downloadFormData = new FormData();
        downloadFormData.append('email', uniqueEmail);
        
        console.log('Downloading results for email:', uniqueEmail);
        
        try {
            // Download output.json
            const downloadResponse = await fetch(`${API_BASE_URL}/download-result`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: downloadFormData
            });
            
            if (downloadResponse.ok) {
                const predictions = await downloadResponse.json();
                console.log('Downloaded predictions:', predictions);
                console.log('Energy data sample:', predictions.energy_aggregated_results?.[0]);
                console.log('Cost data sample:', predictions.costing_results?.[0]);
                
                // Extract building metadata from the backend response
                // The backend now includes metadata in energy_aggregated_results and costing_results
                const energyData = predictions.energy_aggregated_results?.[0] || {};
                const costData = predictions.costing_results?.[0] || {};
                
                // Prefer energy data if available, fallback to cost data
                const sourceData = Object.keys(energyData).length > 0 ? energyData : costData;
                
                console.log('Source data for metadata:', sourceData);
                
                // Extract building metadata from the backend response
                // Extract city name from location string (e.g., "CAN_ON_Toronto.Pearson.Intl.AP.716240_CWEC.epw" -> "Toronto")
                const locationString = sourceData[':epw_file'] || sourceData['epw_file'] || 'Unknown';
                let cityName = 'Unknown';
                if (locationString !== 'Unknown') {
                    // Remove CAN_ prefix and file extension
                    const cleaned = locationString.replace(/^CAN_/, '').replace(/\.epw$/, '').replace(/_CWEC.*$/, '');
                    // Split by underscore and get the part after province code (ON_, BC_, etc.)
                    const parts = cleaned.split('_');
                    if (parts.length > 1) {
                        // Get city name (after province code, before airport/station info)
                        // Split by both dots and spaces to get just the city name
                        cityName = parts[1].split(/[.\s]/)[0];
                    } else {
                        cityName = parts[0].split(/[.\s]/)[0];
                    }
                }
                
                predictions.building_metadata = {
                    floor_area: sourceData['bldg_conditioned_floor_area_m_sq'] || 0,
                    building_type: sourceData['bldg_standards_building_type'] || sourceData[':building_type'] || 'Unknown',
                    location: cityName
                };
                
                console.log('Building metadata:', predictions.building_metadata);
                
                return predictions;
            } else {
                const errorText = await downloadResponse.text();
                console.error('Download failed:', downloadResponse.status, errorText);
                throw new Error(`Download failed with status ${downloadResponse.status}`);
            }
        } catch (err) {
            console.error('Download error:', err);
            throw new Error(`Failed to download results: ${err.message}`);
        }
    }
    
    throw new Error('Prediction succeeded but no output key found');
}

// Display results
function displayResults(results) {
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    
    console.log('Displaying results:', results);
    
    // Check if this is an alternative configuration analysis
    if (results.analysisType === 'alternative') {
        displayAlternativeResults(results);
        return;
    }
    
    let htmlContent = `
        <div style="display: flex; justify-content: flex-end; margin-bottom: 15px;">
            <button onclick="downloadSinglePDFReport()" class="btn btn-primary" style="padding: 10px 20px; font-size: 14px;">
                📄 Download PDF Report
            </button>
        </div>
        <div class="result-grid">`;
    
    // Check if we have energy_aggregated_results and costing_results
    if (results.energy_aggregated_results && results.energy_aggregated_results.length > 0 &&
        results.costing_results && results.costing_results.length > 0) {
        
        const energyData = results.energy_aggregated_results[0];
        const costData = results.costing_results[0];
        
        console.log('Energy data:', energyData);
        console.log('Cost data:', costData);
        console.log('Cost keys:', Object.keys(costData).filter(k => k.includes('cost')));
        
        // Extract Total Energy (Electricity + Gas in GJ/m²)
        const electricityGJ = energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0;
        const gasGJ = energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0;
        const totalEnergyGJ = electricityGJ + gasGJ;
        
        // Extract building metadata from the input Excel file
        const metadata = results.building_metadata || {};
        const floorArea = metadata.floor_area || 0;
        const buildingType = metadata.building_type || 'Unknown';
        const location = metadata.location || 'Unknown';
        
        // Extract and sum all cost components from costing_results (CAD/m²)
        const envelopeCost = costData["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0;
        const hvacCost = costData["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0;
        const lightingCost = costData["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0;
        const ventilationCost = costData["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0;
        const shwCost = costData["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0;
        
        console.log('Extracted costs:', { envelopeCost, hvacCost, lightingCost, ventilationCost, shwCost });
        
        const totalCost = envelopeCost + hvacCost + lightingCost + ventilationCost + shwCost;
        
        htmlContent += `
            <div class="result-card highlight">
                <h4>🔋 Total Energy Use Intensity</h4>
                <div class="value">${totalEnergyGJ.toFixed(7)}</div>
                <div class="unit">GJ/m²</div>
                <p class="subtext">Electricity: ${electricityGJ.toFixed(7)} GJ/m²</p>
                <p class="subtext">Natural Gas: ${gasGJ.toFixed(7)} GJ/m²</p>
            </div>
            <div class="result-card highlight">
                <h4>💰 Total Equipment Cost</h4>
                <div class="value">${totalCost.toFixed(2)}</div>
                <div class="unit">CAD/m²</div>
                <p class="subtext">Envelope: $${envelopeCost.toFixed(2)}</p>
                <p class="subtext">HVAC: $${hvacCost.toFixed(2)}</p>
                <p class="subtext">Lighting: $${lightingCost.toFixed(2)}</p>
                <p class="subtext">Ventilation: $${ventilationCost.toFixed(2)}</p>
                <p class="subtext">Hot Water: $${shwCost.toFixed(2)}</p>
            </div>
            <div class="result-card">
                <h4>🏢 Building Information</h4>
                <div class="value">${floorArea.toFixed(0)}</div>
                <div class="unit">m²</div>
                <p class="subtext">Type: ${buildingType}</p>
                <p class="subtext">Location: ${location}</p>
            </div>
        `;
    }
    // If results only contain status/output_key, show that
    else if (results.status === 'success' && !results.energy_aggregated_results) {
        htmlContent += `
            <div class="result-card" style="grid-column: 1 / -1;">
                <h4>✅ Prediction Complete</h4>
                <p>Output saved to: ${results.output_key || 'S3'}</p>
                <p class="subtext">Results are being processed...</p>
            </div>
        `;
    } else {
        // Display helpful message
        htmlContent += `
            <div class="result-card" style="grid-column: 1 / -1;">
                <h4>⚠️ Unexpected Data Structure</h4>
                <p>Missing energy_aggregated_results or costing_results</p>
                <p class="subtext">Check browser console for details</p>
                <details>
                    <summary>Show raw data</summary>
                    <pre style="max-height: 400px; overflow-y: auto; text-align: left;">${JSON.stringify(results, null, 2)}</pre>
                </details>
            </div>
        `;
    }
    
    htmlContent += '</div></div>';
    
    resultsContent.innerHTML = htmlContent;
    resultsSection.style.display = 'block';
    
    // Store data for single prediction PDF generation
    if (results.energy_aggregated_results && results.costing_results) {
        storeSinglePredictionForPDF(results);
    }
    
    // Smooth scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Display alternative configuration results
function displayAlternativeResults(results) {
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    
    console.log('Displaying alternative configuration results');
    
    if (!results.energy_aggregated_results || !results.costing_results ||
        results.energy_aggregated_results.length === 0 || results.costing_results.length === 0) {
        resultsContent.innerHTML = `
            <div class="result-card" style="grid-column: 1 / -1;">
                <h4>⚠️ Incomplete Results</h4>
                <p>Expected multiple configurations but received ${results.energy_aggregated_results?.length || 0}</p>
            </div>
        `;
        resultsSection.style.display = 'block';
        return;
    }
    
    const numConfigs = results.energy_aggregated_results.length;
    console.log(`Processing ${numConfigs} configurations`);
    
    // Extract data for all configurations
    const configs = [];
    for (let i = 0; i < numConfigs; i++) {
        const energyData = results.energy_aggregated_results[i];
        const costData = results.costing_results[i];
        
        const electricityGJ = energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0;
        const gasGJ = energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0;
        const totalEnergyGJ = electricityGJ + gasGJ;
        
        const envelopeCost = costData["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0;
        const hvacCost = costData["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0;
        const lightingCost = costData["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0;
        const ventilationCost = costData["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0;
        const shwCost = costData["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0;
        const totalCost = envelopeCost + hvacCost + lightingCost + ventilationCost + shwCost;
        
        // Get parameter value
        const paramValue = energyData[':' + results.variableParameter] || costData[':' + results.variableParameter] || i + 1;
        
        configs.push({
            index: i + 1,
            paramValue: paramValue,
            totalEnergy: totalEnergyGJ,
            electricity: electricityGJ,
            gas: gasGJ,
            totalCost: totalCost,
            envelopeCost: envelopeCost,
            hvacCost: hvacCost,
            lightingCost: lightingCost,
            ventilationCost: ventilationCost,
            shwCost: shwCost
        });
    }
    
    console.log('Configurations:', configs);
    
    // Get parameter display name
    const parameterNames = {
        'ext_wall_cond': 'External Wall Thermal Conductance (W/m²·K)',
        'ext_roof_cond': 'External Roof Thermal Conductance (W/m²·K)',
        'fixed_window_cond': 'Window Thermal Conductance (W/m²·K)',
        'fixed_wind_solar_trans': 'Window Solar Heat Gain Coefficient',
        'fdwr_set': 'Window-to-Wall Ratio (%)',
        'srr_set': 'Skylight-to-Roof Ratio (%)',
        'boiler_eff': 'Boiler Efficiency',
        'furnace_eff': 'Furnace Efficiency',
        'shw_eff': 'Service Hot Water Efficiency'
    };
    
    const parameterDisplayName = parameterNames[results.variableParameter] || results.variableParameter;
    
    // Build HTML
    let htmlContent = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="margin: 0;">Alternative Configuration Analysis: ${parameterDisplayName}</h3>
            <button onclick="downloadPDFReport()" class="btn btn-primary" style="padding: 10px 20px; font-size: 14px;">
                📄 Download PDF Report
            </button>
        </div>
        
        <!-- Configuration Comparison Table -->
        <div style="overflow-x: auto; margin-bottom: 30px;">
            <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                <thead>
                    <tr style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
                        <th style="padding: 15px; text-align: left;">Configuration</th>
                        <th style="padding: 15px; text-align: left;">Parameter Value</th>
                        <th style="padding: 15px; text-align: right;">Total Energy (GJ/m²)</th>
                        <th style="padding: 15px; text-align: right;">Total Cost (CAD/m²)</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    configs.forEach((config, idx) => {
        const rowBg = idx % 2 === 0 ? '#f8f9ff' : 'white';
        htmlContent += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #e1e8ed; cursor: pointer; transition: background 0.2s;" 
                onmouseover="this.style.background='#e6f2ff'" 
                onmouseout="this.style.background='${rowBg}'"
                onclick="toggleConfigDetails(${config.index})">
                <td style="padding: 12px; font-weight: bold;">Config ${config.index} <span style="color: #667eea; font-size: 12px;">▼</span></td>
                <td style="padding: 12px;">${config.paramValue}</td>
                <td style="padding: 12px; text-align: right; font-family: monospace;">${config.totalEnergy.toFixed(6)}</td>
                <td style="padding: 12px; text-align: right;">$${config.totalCost.toFixed(2)}</td>
            </tr>
            <tr id="details-${config.index}" style="display: none; background: #f0f4ff;">
                <td colspan="4" style="padding: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                        <div>
                            <h5 style="margin: 0 0 10px 0; color: #2d3748;">⚡ Energy Breakdown</h5>
                            <p style="margin: 5px 0; font-size: 14px;">Electricity: <strong>${config.electricity.toFixed(6)} GJ/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Natural Gas: <strong>${config.gas.toFixed(6)} GJ/m²</strong></p>
                            <p style="margin: 10px 0 0 0; font-size: 14px; color: #667eea;">Total: <strong>${config.totalEnergy.toFixed(6)} GJ/m²</strong></p>
                        </div>
                        <div>
                            <h5 style="margin: 0 0 10px 0; color: #2d3748;">💰 Cost Breakdown</h5>
                            <p style="margin: 5px 0; font-size: 14px;">Envelope: <strong>$${config.envelopeCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">HVAC: <strong>$${config.hvacCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Lighting: <strong>$${config.lightingCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Ventilation: <strong>$${config.ventilationCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 5px 0; font-size: 14px;">Hot Water: <strong>$${config.shwCost.toFixed(2)}/m²</strong></p>
                            <p style="margin: 10px 0 0 0; font-size: 14px; color: #48bb78;">Total: <strong>$${config.totalCost.toFixed(2)}/m²</strong></p>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });
    
    htmlContent += `
                </tbody>
            </table>
        </div>
        
        <!-- Visualization Charts -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 20px; max-width: 100%;">
            <div class="chart-container" style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); min-width: 0; max-width: 100%;">
                <h4 style="margin: 0 0 20px 0; color: #2d3748; text-align: center; font-size: 18px; font-weight: 600;">📊 Energy Use Intensity Comparison</h4>
                <div style="position: relative; width: 100%; height: 350px;">
                    <canvas id="energyChart" style="width: 100%; height: 100%; cursor: pointer;"></canvas>
                    <div id="energyTooltip" style="display: none; position: absolute; background: rgba(0,0,0,0.85); color: white; padding: 12px 16px; border-radius: 8px; pointer-events: none; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; white-space: nowrap;"></div>
                </div>
            </div>
            <div class="chart-container" style="background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); min-width: 0; max-width: 100%;">
                <h4 style="margin: 0 0 20px 0; color: #2d3748; text-align: center; font-size: 18px; font-weight: 600;">💰 Cost Comparison</h4>
                <div style="position: relative; width: 100%; height: 350px;">
                    <canvas id="costChart" style="width: 100%; height: 100%; cursor: pointer;"></canvas>
                    <div id="costTooltip" style="display: none; position: absolute; background: rgba(0,0,0,0.85); color: white; padding: 12px 16px; border-radius: 8px; pointer-events: none; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; white-space: nowrap;"></div>
                </div>
            </div>
        </div>
    `;
    
    resultsContent.innerHTML = htmlContent;
    resultsSection.style.display = 'block';
    
    // Smooth scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    
    // Store configs globally for PDF generation
    storeConfigsForPDF(configs, parameterDisplayName, results);
    
    // Draw charts with hover functionality
    drawEnergyChart(configs);
    drawCostChart(configs);
}

// Toggle configuration details
function toggleConfigDetails(configIndex) {
    const detailsRow = document.getElementById(`details-${configIndex}`);
    const allDetailsRows = document.querySelectorAll('[id^="details-"]');
    
    // Close all other detail rows
    allDetailsRows.forEach(row => {
        if (row.id !== `details-${configIndex}`) {
            row.style.display = 'none';
        }
    });
    
    // Toggle current row
    if (detailsRow.style.display === 'none') {
        detailsRow.style.display = 'table-row';
    } else {
        detailsRow.style.display = 'none';
    }
}

// Draw energy comparison chart
function drawEnergyChart(configs) {
    const canvas = document.getElementById('energyChart');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 50, right: 30, bottom: 60, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Find max value for scaling
    const maxEnergy = Math.max(...configs.map(c => c.totalEnergy)) * 1.15;
    const minEnergy = Math.min(...configs.map(c => c.totalEnergy)) * 0.95;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw bars
    const barWidth = (chartWidth / configs.length) * 0.65;
    const barSpacing = chartWidth / configs.length;
    
    configs.forEach((config, i) => {
        const barHeight = ((config.totalEnergy - minEnergy) / (maxEnergy - minEnergy)) * chartHeight;
        const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        
        // Draw shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        
        // Draw bar
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#667eea');
        gradient.addColorStop(1, '#764ba2');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Draw value on top with smaller font and 4 decimals
        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(config.totalEnergy.toFixed(4), x + barWidth / 2, y - 8);
        
        // Draw label
        ctx.fillStyle = '#4a5568';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`${config.index}`, x + barWidth / 2, padding.top + chartHeight + 25);
    });
    
    // Draw axes
    ctx.strokeStyle = '#a0aec0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Energy Use Intensity (GJ/m²)', 0, 0);
    ctx.restore();
    
    // Add hover detection
    canvas.onmousemove = function(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const tooltip = document.getElementById('energyTooltip');
        let hoveredConfig = null;
        
        // Check if mouse is over any bar
        configs.forEach((config, i) => {
            const barWidth = (chartWidth / configs.length) * 0.65;
            const barSpacing = chartWidth / configs.length;
            const barHeight = ((config.totalEnergy - minEnergy) / (maxEnergy - minEnergy)) * chartHeight;
            const barX = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
            const barY = padding.top + chartHeight - barHeight;
            
            if (x >= barX && x <= barX + barWidth && y >= barY && y <= barY + barHeight) {
                hoveredConfig = config;
            }
        });
        
        if (hoveredConfig) {
            tooltip.innerHTML = `
                <strong>Configuration ${hoveredConfig.index}</strong><br/>
                Electricity: ${hoveredConfig.electricity.toFixed(4)} GJ/m²<br/>
                Gas: ${hoveredConfig.gas.toFixed(4)} GJ/m²<br/>
                <strong>Total: ${hoveredConfig.totalEnergy.toFixed(4)} GJ/m²</strong>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        } else {
            tooltip.style.display = 'none';
        }
    };
    
    canvas.onmouseleave = function() {
        document.getElementById('energyTooltip').style.display = 'none';
    };
}

// Draw cost comparison chart
function drawCostChart(configs) {
    const canvas = document.getElementById('costChart');
    const ctx = canvas.getContext('2d');
    
    // Set canvas size with device pixel ratio for crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    
    const width = rect.width;
    const height = rect.height;
    const padding = { top: 50, right: 30, bottom: 60, left: 70 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    
    // Find max value for scaling
    const maxCost = Math.max(...configs.map(c => c.totalCost)) * 1.15;
    const minCost = Math.min(...configs.map(c => c.totalCost)) * 0.95;
    
    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background grid
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padding.top + (chartHeight / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(padding.left + chartWidth, y);
        ctx.stroke();
    }
    
    // Draw bars
    const barWidth = (chartWidth / configs.length) * 0.65;
    const barSpacing = chartWidth / configs.length;
    
    configs.forEach((config, i) => {
        const barHeight = ((config.totalCost - minCost) / (maxCost - minCost)) * chartHeight;
        const x = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
        const y = padding.top + chartHeight - barHeight;
        
        // Draw shadow
        ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        
        // Draw bar
        const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
        gradient.addColorStop(0, '#48bb78');
        gradient.addColorStop(1, '#2f855a');
        ctx.fillStyle = gradient;
        ctx.fillRect(x, y, barWidth, barHeight);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        
        // Draw value on top with smaller font
        ctx.fillStyle = '#2d3748';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('$' + config.totalCost.toFixed(2), x + barWidth / 2, y - 8);
        
        // Draw label
        ctx.fillStyle = '#4a5568';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(`${config.index}`, x + barWidth / 2, padding.top + chartHeight + 25);
    });
    
    // Draw axes
    ctx.strokeStyle = '#a0aec0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, padding.top + chartHeight);
    ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
    ctx.stroke();
    
    // Y-axis label
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#4a5568';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Equipment Cost (CAD/m²)', 0, 0);
    ctx.restore();
    
    // Add hover detection
    canvas.onmousemove = function(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const tooltip = document.getElementById('costTooltip');
        let hoveredConfig = null;
        
        // Check if mouse is over any bar
        configs.forEach((config, i) => {
            const barWidth = (chartWidth / configs.length) * 0.65;
            const barSpacing = chartWidth / configs.length;
            const barHeight = ((config.totalCost - minCost) / (maxCost - minCost)) * chartHeight;
            const barX = padding.left + i * barSpacing + (barSpacing - barWidth) / 2;
            const barY = padding.top + chartHeight - barHeight;
            
            if (x >= barX && x <= barX + barWidth && y >= barY && y <= barY + barHeight) {
                hoveredConfig = config;
            }
        });
        
        if (hoveredConfig) {
            tooltip.innerHTML = `
                <strong>Configuration ${hoveredConfig.index}</strong><br/>
                Envelope: $${hoveredConfig.envelopeCost.toFixed(2)}/m²<br/>
                HVAC: $${hoveredConfig.hvacCost.toFixed(2)}/m²<br/>
                Lighting: $${hoveredConfig.lightingCost.toFixed(2)}/m²<br/>
                Ventilation: $${hoveredConfig.ventilationCost.toFixed(2)}/m²<br/>
                Hot Water: $${hoveredConfig.shwCost.toFixed(2)}/m²<br/>
                <strong>Total: $${hoveredConfig.totalCost.toFixed(2)}/m²</strong>
            `;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX - rect.left + 15) + 'px';
            tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        } else {
            tooltip.style.display = 'none';
        }
    };
    
    canvas.onmouseleave = function() {
        document.getElementById('costTooltip').style.display = 'none';
    };
}

// Store configs globally for PDF generation
let globalConfigs = null;
let globalParameterDisplayName = null;
let globalResults = null;
let globalSinglePrediction = null;

// Update the displayAlternativeResults to store configs globally
function storeConfigsForPDF(configs, parameterDisplayName, results) {
    globalConfigs = configs;
    globalParameterDisplayName = parameterDisplayName;
    globalResults = results;
}

// Store single prediction data for PDF generation
function storeSinglePredictionForPDF(results) {
    const energyData = results.energy_aggregated_results[0];
    const costData = results.costing_results[0];
    
    globalSinglePrediction = {
        electricityGJ: energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0,
        gasGJ: energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0,
        totalEnergyGJ: (energyData["Predicted Electricity Energy Total (Gigajoules per square meter)"] || 0) + (energyData["Predicted Gas Energy Total (Gigajoules per square meter)"] || 0),
        envelopeCost: costData["Predicted cost_equipment_envelope_total_cost_per_m_sq"] || 0,
        hvacCost: costData["Predicted cost_equipment_heating_and_cooling_total_cost_per_m_sq"] || 0,
        lightingCost: costData["Predicted cost_equipment_lighting_total_cost_per_m_sq"] || 0,
        ventilationCost: costData["Predicted cost_equipment_ventilation_total_cost_per_m_sq"] || 0,
        shwCost: costData["Predicted cost_equipment_shw_total_cost_per_m_sq"] || 0,
        metadata: results.building_metadata
    };
    globalSinglePrediction.totalCost = globalSinglePrediction.envelopeCost + globalSinglePrediction.hvacCost + 
                                       globalSinglePrediction.lightingCost + globalSinglePrediction.ventilationCost + 
                                       globalSinglePrediction.shwCost;
}

// Download PDF Report for Single Prediction
async function downloadSinglePDFReport() {
    if (!globalSinglePrediction) {
        alert('No data available to generate report');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    
    // Add logo and letterhead
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('CANBUILDAI', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Building Design Decision Maker', pageWidth / 2, 28, { align: 'center' });
    doc.text('Single Building Prediction Report', pageWidth / 2, 35, { align: 'center' });
    
    yPos = 50;
    
    // Report Title
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Building Performance Prediction Report', 15, yPos);
    yPos += 10;
    
    // Date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString()}`, 15, yPos);
    yPos += 10;
    
    // Building Information Section
    if (globalSinglePrediction.metadata) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Building Information', 15, yPos);
        yPos += 7;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const metadata = globalSinglePrediction.metadata;
        doc.text(`Floor Area: ${metadata.floor_area?.toFixed(0) || 'N/A'} m²`, 20, yPos);
        yPos += 5;
        doc.text(`Building Type: ${metadata.building_type || 'N/A'}`, 20, yPos);
        yPos += 5;
        doc.text(`Location: ${metadata.location || 'N/A'}`, 20, yPos);
        yPos += 15;
    }
    
    // Energy Performance Section
    doc.setFillColor(102, 126, 234);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 10, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Energy Performance', 20, yPos + 6.5);
    yPos += 15;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Energy Use Intensity: ${globalSinglePrediction.totalEnergyGJ.toFixed(7)} GJ/m²`, 20, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Energy Breakdown:', 20, yPos);
    yPos += 6;
    doc.text(`  • Electricity: ${globalSinglePrediction.electricityGJ.toFixed(7)} GJ/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Natural Gas: ${globalSinglePrediction.gasGJ.toFixed(7)} GJ/m²`, 25, yPos);
    yPos += 15;
    
    // Cost Analysis Section
    doc.setFillColor(72, 187, 120);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 10, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Equipment Cost Analysis', 20, yPos + 6.5);
    yPos += 15;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Equipment Cost: $${globalSinglePrediction.totalCost.toFixed(2)}/m²`, 20, yPos);
    yPos += 10;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Cost Breakdown by Component:', 20, yPos);
    yPos += 6;
    doc.text(`  • Envelope: $${globalSinglePrediction.envelopeCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • HVAC (Heating & Cooling): $${globalSinglePrediction.hvacCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Lighting: $${globalSinglePrediction.lightingCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Ventilation: $${globalSinglePrediction.ventilationCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 5;
    doc.text(`  • Service Hot Water: $${globalSinglePrediction.shwCost.toFixed(2)}/m²`, 25, yPos);
    yPos += 15;
    
    // Summary Section
    doc.setFillColor(102, 126, 234);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 10, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Performance Summary', 20, yPos + 6.5);
    yPos += 15;
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('This report provides a comprehensive analysis of the predicted building performance', 20, yPos);
    yPos += 5;
    doc.text('based on the selected configuration parameters. The energy use intensity reflects', 20, yPos);
    yPos += 5;
    doc.text('the total annual energy consumption per square meter, while equipment costs', 20, yPos);
    yPos += 5;
    doc.text('represent the capital investment required for each building system.', 20, yPos);
    
    // Add footer
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(128, 128, 128);
    doc.text('Page 1 of 1', pageWidth / 2, pageHeight - 10, { align: 'center' });
    doc.text('CANBUILDAI - Building Design Decision Maker', pageWidth / 2, pageHeight - 6, { align: 'center' });
    
    // Save the PDF
    const fileName = `CANBUILDAI_Single_Prediction_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
}

// Download PDF Report
async function downloadPDFReport() {
    if (!globalConfigs || !globalResults) {
        alert('No data available to generate report');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let yPos = 20;
    
    // Add logo and letterhead
    doc.setFillColor(102, 126, 234);
    doc.rect(0, 0, pageWidth, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('CANBUILDAI', pageWidth / 2, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Building Design Decision Maker', pageWidth / 2, 28, { align: 'center' });
    doc.text('Alternative Configuration Analysis Report', pageWidth / 2, 35, { align: 'center' });
    
    yPos = 50;
    
    // Report Title
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Configuration Analysis Report', 15, yPos);
    yPos += 10;
    
    // Date
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleString()}`, 15, yPos);
    yPos += 5;
    doc.text(`Parameter Analyzed: ${globalParameterDisplayName}`, 15, yPos);
    yPos += 10;
    
    // Building Information Section
    if (globalResults.building_metadata) {
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text('Building Information', 15, yPos);
        yPos += 7;
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const metadata = globalResults.building_metadata;
        doc.text(`Floor Area: ${metadata.floor_area?.toFixed(0) || 'N/A'} m²`, 20, yPos);
        yPos += 5;
        doc.text(`Building Type: ${metadata.building_type || 'N/A'}`, 20, yPos);
        yPos += 5;
        doc.text(`Location: ${metadata.location || 'N/A'}`, 20, yPos);
        yPos += 10;
    }
    
    // Summary Statistics
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Configuration Summary', 15, yPos);
    yPos += 7;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const minEnergy = Math.min(...globalConfigs.map(c => c.totalEnergy));
    const maxEnergy = Math.max(...globalConfigs.map(c => c.totalEnergy));
    const avgEnergy = globalConfigs.reduce((sum, c) => sum + c.totalEnergy, 0) / globalConfigs.length;
    const minCost = Math.min(...globalConfigs.map(c => c.totalCost));
    const maxCost = Math.max(...globalConfigs.map(c => c.totalCost));
    const avgCost = globalConfigs.reduce((sum, c) => sum + c.totalCost, 0) / globalConfigs.length;
    
    doc.text(`Total Configurations Analyzed: ${globalConfigs.length}`, 20, yPos);
    yPos += 5;
    doc.text(`Energy Range: ${minEnergy.toFixed(4)} - ${maxEnergy.toFixed(4)} GJ/m²`, 20, yPos);
    yPos += 5;
    doc.text(`Average Energy: ${avgEnergy.toFixed(4)} GJ/m²`, 20, yPos);
    yPos += 5;
    doc.text(`Cost Range: $${minCost.toFixed(2)} - $${maxCost.toFixed(2)}/m²`, 20, yPos);
    yPos += 5;
    doc.text(`Average Cost: $${avgCost.toFixed(2)}/m²`, 20, yPos);
    yPos += 10;
    
    // Comparison Table
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Configuration Comparison', 15, yPos);
    yPos += 7;
    
    // Table headers
    doc.setFillColor(102, 126, 234);
    doc.setTextColor(255, 255, 255);
    doc.rect(15, yPos, pageWidth - 30, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Config', 20, yPos + 5.5);
    doc.text('Parameter Value', 50, yPos + 5.5);
    doc.text('Energy (GJ/m²)', 110, yPos + 5.5);
    doc.text('Cost (CAD/m²)', 155, yPos + 5.5);
    yPos += 8;
    
    // Table rows
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    globalConfigs.forEach((config, idx) => {
        if (yPos > pageHeight - 30) {
            doc.addPage();
            yPos = 20;
        }
        
        const bgColor = idx % 2 === 0 ? [248, 249, 255] : [255, 255, 255];
        doc.setFillColor(...bgColor);
        doc.rect(15, yPos, pageWidth - 30, 7, 'F');
        
        doc.text(`${config.index}`, 20, yPos + 5);
        doc.text(`${config.paramValue}`, 50, yPos + 5);
        doc.text(`${config.totalEnergy.toFixed(6)}`, 110, yPos + 5);
        doc.text(`$${config.totalCost.toFixed(2)}`, 155, yPos + 5);
        yPos += 7;
    });
    
    yPos += 5;
    
    // Add new page for charts
    doc.addPage();
    yPos = 20;
    
    // Add Energy Chart
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Energy Use Intensity Comparison', 15, yPos);
    yPos += 10;
    
    const energyCanvas = document.getElementById('energyChart');
    const energyImgData = energyCanvas.toDataURL('image/png');
    doc.addImage(energyImgData, 'PNG', 15, yPos, 180, 80);
    yPos += 90;
    
    // Add Cost Chart
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Cost Comparison', 15, yPos);
    yPos += 10;
    
    const costCanvas = document.getElementById('costChart');
    const costImgData = costCanvas.toDataURL('image/png');
    doc.addImage(costImgData, 'PNG', 15, yPos, 180, 80);
    yPos += 90;
    
    // Add detailed breakdowns on new page
    doc.addPage();
    yPos = 20;
    
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Detailed Configuration Breakdown', 15, yPos);
    yPos += 10;
    
    globalConfigs.forEach((config) => {
        if (yPos > pageHeight - 60) {
            doc.addPage();
            yPos = 20;
        }
        
        // Configuration header
        doc.setFillColor(102, 126, 234);
        doc.setTextColor(255, 255, 255);
        doc.rect(15, yPos, pageWidth - 30, 8, 'F');
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(`Configuration ${config.index} - Parameter Value: ${config.paramValue}`, 20, yPos + 5.5);
        yPos += 13;
        
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('Energy Breakdown:', 20, yPos);
        yPos += 5;
        
        doc.setFont('helvetica', 'normal');
        doc.text(`  Electricity: ${config.electricity.toFixed(6)} GJ/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Natural Gas: ${config.gas.toFixed(6)} GJ/m²`, 25, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'bold');
        doc.text(`  Total Energy: ${config.totalEnergy.toFixed(6)} GJ/m²`, 25, yPos);
        yPos += 8;
        
        doc.setFont('helvetica', 'bold');
        doc.text('Cost Breakdown:', 20, yPos);
        yPos += 5;
        
        doc.setFont('helvetica', 'normal');
        doc.text(`  Envelope: $${config.envelopeCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  HVAC: $${config.hvacCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Lighting: $${config.lightingCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Ventilation: $${config.ventilationCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.text(`  Hot Water: $${config.shwCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 5;
        doc.setFont('helvetica', 'bold');
        doc.text(`  Total Cost: $${config.totalCost.toFixed(2)}/m²`, 25, yPos);
        yPos += 10;
    });
    
    // Add footer on each page
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(128, 128, 128);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
        doc.text('CANBUILDAI - Building Design Decision Maker', pageWidth / 2, pageHeight - 6, { align: 'center' });
    }
    
    // Save the PDF
    const fileName = `CANBUILDAI_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(fileName);
}

// Display error
function displayError(message) {
    const resultsSection = document.getElementById('results');
    const resultsContent = document.getElementById('resultsContent');
    
    resultsContent.innerHTML = `
        <div class="result-card" style="grid-column: 1 / -1; background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%);">
            <h4>⚠️ Error</h4>
            <p>${message}</p>
            <p class="subtext">Please check your inputs and try again.</p>
        </div>
    `;
    
    resultsSection.style.display = 'block';
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Show loading overlay
function showLoading() {
    document.getElementById('loadingOverlay').style.display = 'flex';
}

// Hide loading overlay
function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}
