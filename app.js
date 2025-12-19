// Configuration
const API_BASE_URL = 'https://08879hja2c.execute-api.ca-central-1.amazonaws.com/surrogate_model';
const BUCKET_NAME = 'btap-app-test3-dev-tgw-3-btap-v1-uploads';
const AWS_REGION = 'ca-central-1';

// Form handling
document.getElementById('buildingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Get form data
    const formData = new FormData(e.target);
    const buildingConfig = {};
    
    for (let [key, value] of formData.entries()) {
        // Convert numeric strings to numbers
        if (!isNaN(value) && value !== '') {
            buildingConfig[':' + key] = parseFloat(value);
        } else {
            buildingConfig[':' + key] = value;
        }
    }
    
    console.log('Building Configuration:', buildingConfig);
    
    // Show loading overlay
    showLoading();
    
    try {
        // Generate Excel file from configuration
        const excelBlob = await generateExcelFile(buildingConfig);
        
        // Upload to API
        const results = await uploadAndPredict(excelBlob);
        
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
    const defaultsResponse = await fetch('/defaults_from_excel.json');
    const allDefaults = await defaultsResponse.json();
    
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
    const uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: uploadFormData
    });
    
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
                predictions.building_metadata = {
                    floor_area: sourceData['bldg_conditioned_floor_area_m_sq'] || 0,
                    building_type: sourceData['bldg_standards_building_type'] || sourceData[':building_type'] || 'Unknown',
                    location: (sourceData[':epw_file'] || sourceData['epw_file'] || 'Unknown').replace(/^CAN_/, '').replace(/_CWEC.*$/, '').replace(/\./g, ' ')
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
    
    let htmlContent = '<div class="result-grid">';
    
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
                <div class="value">${totalEnergyGJ}</div>
                <div class="unit">GJ/m²</div>
                <p class="subtext">Electricity: ${electricityGJ} GJ/m²</p>
                <p class="subtext">Natural Gas: ${gasGJ} GJ/m²</p>
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
    
    htmlContent += '</div>';
    
    resultsContent.innerHTML = htmlContent;
    resultsSection.style.display = 'block';
    
    // Smooth scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
