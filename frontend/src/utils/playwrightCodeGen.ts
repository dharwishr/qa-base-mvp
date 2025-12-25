/**
 * Generates Playwright test code from recorded steps.
 */

import type { PlaywrightStep } from '@/types/scripts';

function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function generateSelectorCode(selector: string): string {
  // Handle different selector formats
  if (selector.startsWith('xpath=')) {
    const xpath = selector.slice(6);
    return `page.locator('xpath=${escapeString(xpath)}')`;
  }
  if (selector.startsWith('text=')) {
    const text = selector.slice(5);
    return `page.getByText('${escapeString(text)}')`;
  }
  if (selector.startsWith('role=')) {
    const role = selector.slice(5);
    return `page.getByRole('${escapeString(role)}')`;
  }
  // CSS selector or other
  return `page.locator('${escapeString(selector)}')`;
}

function generateAssertionCode(step: PlaywrightStep): string {
  if (!step.assertion) return '';
  
  const assertion = step.assertion;
  const timeout = step.timeout || 30000;
  
  switch (assertion.assertion_type) {
    case 'text_visible':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        if (assertion.partial_match) {
          return `  await expect(${locator}).toContainText('${escapeString(assertion.expected_value || '')}', { timeout: ${timeout} });`;
        }
        return `  await expect(${locator}).toHaveText('${escapeString(assertion.expected_value || '')}', { timeout: ${timeout} });`;
      }
      return `  await expect(page.getByText('${escapeString(assertion.expected_value || '')}')).toBeVisible({ timeout: ${timeout} });`;
    
    case 'element_visible':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `  await expect(${locator}).toBeVisible({ timeout: ${timeout} });`;
      }
      return '';
    
    case 'url_contains':
      return `  await expect(page).toHaveURL(/${escapeString(assertion.expected_value || '')}/, { timeout: ${timeout} });`;
    
    case 'url_equals':
      return `  await expect(page).toHaveURL('${escapeString(assertion.expected_value || '')}', { timeout: ${timeout} });`;
    
    case 'value_equals':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `  await expect(${locator}).toHaveValue('${escapeString(assertion.expected_value || '')}', { timeout: ${timeout} });`;
      }
      return '';
    
    case 'element_count':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `  await expect(${locator}).toHaveCount(${assertion.expected_count || 0}, { timeout: ${timeout} });`;
      }
      return '';
    
    default:
      return `  // Unknown assertion type: ${assertion.assertion_type}`;
  }
}

function generateStepCode(step: PlaywrightStep): string {
  const timeout = step.timeout || 30000;
  const comment = step.description ? `  // ${step.description}\n` : '';
  
  switch (step.action) {
    case 'goto':
      return `${comment}  await page.goto('${escapeString(step.url || '')}', { waitUntil: '${step.wait_for || 'domcontentloaded'}', timeout: ${timeout} });`;
    
    case 'click':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `${comment}  await ${locator}.click({ timeout: ${timeout} });`;
      }
      return `${comment}  // Click action missing selector`;
    
    case 'fill':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `${comment}  await ${locator}.fill('${escapeString(step.value || '')}', { timeout: ${timeout} });`;
      }
      return `${comment}  // Fill action missing selector`;
    
    case 'select':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `${comment}  await ${locator}.selectOption('${escapeString(step.value || '')}', { timeout: ${timeout} });`;
      }
      return `${comment}  // Select action missing selector`;
    
    case 'press':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `${comment}  await ${locator}.press('${escapeString(step.key || '')}');`;
      }
      return `${comment}  await page.keyboard.press('${escapeString(step.key || '')}');`;
    
    case 'scroll':
      const amount = step.amount || 500;
      const direction = step.direction === 'up' ? -amount : amount;
      return `${comment}  await page.mouse.wheel(0, ${direction});`;
    
    case 'wait':
      const waitMs = step.timeout || 1000;
      return `${comment}  await page.waitForTimeout(${waitMs});`;
    
    case 'hover':
      if (step.selectors) {
        const locator = generateSelectorCode(step.selectors.primary);
        return `${comment}  await ${locator}.hover({ timeout: ${timeout} });`;
      }
      return `${comment}  // Hover action missing selector`;
    
    case 'assert':
      return `${comment}${generateAssertionCode(step)}`;
    
    default:
      return `${comment}  // Unknown action: ${step.action}`;
  }
}

export function generatePlaywrightCode(steps: PlaywrightStep[], testName: string = 'Recorded Test'): string {
  const stepCodes = steps.map(step => generateStepCode(step)).join('\n\n');
  
  return `import { test, expect } from '@playwright/test';

test('${escapeString(testName)}', async ({ page }) => {
${stepCodes}
});
`;
}

export function generatePlaywrightCodeWithFallbacks(steps: PlaywrightStep[], testName: string = 'Recorded Test'): string {
  const helperFunction = `
// Helper function for self-healing selectors
async function locateWithFallbacks(page, selectors, timeout = 30000) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      await locator.waitFor({ state: 'visible', timeout: timeout / selectors.length });
      return locator;
    } catch (e) {
      // Try next selector
    }
  }
  throw new Error(\`Could not find element with any selector: \${selectors.join(', ')}\`);
}
`;

  const stepCodes = steps.map(step => {
    if (step.selectors && step.selectors.fallbacks && step.selectors.fallbacks.length > 0) {
      const allSelectors = [step.selectors.primary, ...step.selectors.fallbacks];
      const selectorsArray = `[${allSelectors.map(s => `'${escapeString(s)}'`).join(', ')}]`;
      const comment = step.description ? `  // ${step.description}\n` : '';
      
      switch (step.action) {
        case 'click':
          return `${comment}  const el${step.index} = await locateWithFallbacks(page, ${selectorsArray});\n  await el${step.index}.click();`;
        case 'fill':
          return `${comment}  const el${step.index} = await locateWithFallbacks(page, ${selectorsArray});\n  await el${step.index}.fill('${escapeString(step.value || '')}');`;
        case 'hover':
          return `${comment}  const el${step.index} = await locateWithFallbacks(page, ${selectorsArray});\n  await el${step.index}.hover();`;
        default:
          return generateStepCode(step);
      }
    }
    return generateStepCode(step);
  }).join('\n\n');

  return `import { test, expect } from '@playwright/test';
${helperFunction}
test('${escapeString(testName)}', async ({ page }) => {
${stepCodes}
});
`;
}
