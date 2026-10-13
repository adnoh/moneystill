import { pb } from '../lib/pocketbase';

/**
 * Exports all user-related data from PocketBase to a JSON object.
 */
export const exportUserData = async () => {
    const userId = pb.authStore.model.id;

    // Fetch all relevant data concurrently
    const [categories, monthlyValues, scenarios, scenarioValues] = await Promise.all([
        pb.collection('categories').getFullList({ filter: `user = "${userId}"` }),
        pb.collection('monthly_values').getFullList({ filter: `user = "${userId}"` }),
        pb.collection('scenarios').getFullList({ filter: `user = "${userId}"` }),
        pb.collection('scenario_values').getFullList({ filter: `user = "${userId}"` }),
    ]);

    const exportData = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        data: {
            categories: categories.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                is_fixed: c.is_fixed,
                display_order: c.display_order
            })),
            monthly_values: monthlyValues.map(v => ({
                category: v.category,
                year: v.year,
                month: v.month,
                amount: v.amount
            })),
            scenarios: scenarios.map(s => ({
                id: s.id,
                name: s.name,
                year: s.year
            })),
            scenario_values: scenarioValues.map(v => ({
                scenario: v.scenario,
                category: v.category,
                year: v.year,
                month: v.month,
                amount: v.amount
            }))
        }
    };

    return exportData;
};

/**
 * Imports user data from a JSON object into the current PocketBase instance.
 * Handles ID mapping for categories and scenarios.
 */
export const importUserData = async (importData, options = {}, onProgress) => {
    const userId = pb.authStore.model.id;
    const { 
        skipCategories = false, 
        importValues = true, 
        importScenarios = true, 
        overwriteYear = null 
    } = options;

    const categories = (importData.data && importData.data.categories) || [];
    const monthly_values = (importData.data && importData.data.monthly_values) || [];
    const scenarios = (importData.data && importData.data.scenarios) || [];
    const scenario_values = (importData.data && importData.data.scenario_values) || [];

    const categoryMap = {}; // oldId -> newId
    const scenarioMap = {}; // oldId -> newId

    // Calculate Steps based on selected options
    let totalSteps = 0;
    if (!skipCategories) totalSteps += categories.length;
    if (importScenarios) totalSteps += scenarios.length;
    if (importValues) {
        totalSteps += monthly_values.length;
        totalSteps += scenario_values.length;
    }

    let completed = 0;

    const updateProgress = (message) => {
        const percent = totalSteps > 0 ? Math.round((completed / totalSteps) * 100) : 100;
        if (onProgress) onProgress(message, percent);
    };

    // 1. Import Categories (if not skipped per options)
    if (!skipCategories) {
        updateProgress('Importing categories...');
        for (const cat of categories) {
            const newCat = await pb.collection('categories').create({
                name: cat.name,
                type: cat.type,
                is_fixed: cat.is_fixed,
                display_order: cat.display_order,
                user: userId
            });
            categoryMap[cat.id] = newCat.id;
            completed++;
            updateProgress('Importing categories...');
        }
    } else {
        // If categories skipped, we get the existing categories of the user,
        // to map values and scenarios
        updateProgress('Fetching existing categories...');
        const existingCategories = await pb.collection('categories').getFullList({
            filter: `user = '${userId}'`
        });
        existingCategories.forEach(cat => {
            // Mapping with name (or ID, if old IDs match in the backup)
            // map based on name if old IDs don't exist:
            // loo for matchning Name/Type
            const matched = categories.find(c => c.id === cat.id || (c.name === cat.name && c.type === cat.type));
            if (matched) {
                categoryMap[matched.id] = cat.id;
            } else {
                categoryMap[cat.id] = cat.id; // Fallback
            }
        });
    }

    // 2. Import Scenarios (if importScenarios is active)
    if (importScenarios) {
        updateProgress('Importing scenarios...');
        for (const sc of scenarios) {
            const newSc = await pb.collection('scenarios').create({
                name: sc.name,
                year: overwriteYear ? Number(overwriteYear) : sc.year,
                user: userId
            });
            scenarioMap[sc.id] = newSc.id;
            completed++;
            updateProgress('Importing scenarios...');
        }
    }

    // 3. Import Monthly Values (if importValues is active)
    if (importValues) {
        updateProgress('Importing monthly values...');
        for (const val of monthly_values) {
            const newCategoryId = categoryMap[val.category];
            if (newCategoryId) {
                await pb.collection('monthly_values').create({
                    category: newCategoryId,
                    year: overwriteYear ? Number(overwriteYear) : val.year,
                    month: val.month,
                    amount: val.amount,
                    user: userId
                });
            }
            completed++;
            updateProgress('Importing monthly values...');
        }

        // 4. Import Scenario Values (nur wenn importValues aktiv ist)
        updateProgress('Importing scenario values...');
        for (const val of scenario_values) {
            const newScenarioId = scenarioMap[val.scenario];
            const newCategoryId = categoryMap[val.category];
            // Falls Szenarien übersprungen wurden, versuchen wir evtl. vorhandene Szenarien zuzuordnen
            const targetScenarioId = newScenarioId || val.scenario; 

            if (targetScenarioId && newCategoryId) {
                await pb.collection('scenario_values').create({
                    scenario: targetScenarioId,
                    category: newCategoryId,
                    year: overwriteYear ? Number(overwriteYear) : val.year,
                    month: val.month,
                    amount: val.amount,
                    user: userId
                });
            }
            completed++;
            updateProgress('Importing scenario values...');
        }
    }

    updateProgress('Import complete!', 100);
};
/**
 * Triggers a file download in the browser.
 */
export const downloadJson = (data, filename) => {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
