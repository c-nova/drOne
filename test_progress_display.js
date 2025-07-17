const { test, expect } = require('@playwright/test');

test.describe('Deep Research Progress Display', () => {
  test('displays progress indicator and status updates', async ({ page }) => {
    // Start the local server if needed
    await page.goto('http://localhost:3000');
    
    // Wait for the chat app to load
    await page.waitForSelector('chat-app');
    
    // Get the shadow root
    const chatApp = await page.locator('chat-app');
    
    // Enter a test query
    const testQuery = "最新のAI技術について調べてください";
    await chatApp.locator('input[type="text"]').fill(testQuery);
    await chatApp.locator('button[type="submit"]').click();
    
    // Check that progress indicator appears
    await expect(chatApp.locator('.progress-message')).toBeVisible();
    await expect(chatApp.locator('.progress-spinner')).toBeVisible();
    await expect(chatApp.locator('.progress-indicator')).toContainText('Deep Research');
    
    // Wait for the request to complete (this might take a while)
    await page.waitForTimeout(30000); // 30 seconds timeout
    
    // Check that progress message is removed and AI response appears
    await expect(chatApp.locator('.progress-message')).not.toBeVisible();
    await expect(chatApp.locator('.ai-message')).toBeVisible();
    
    // Check for status updates section
    const statusUpdates = chatApp.locator('.status-updates');
    if (await statusUpdates.count() > 0) {
      await expect(statusUpdates).toContainText('プロセス履歴');
      await expect(statusUpdates.locator('.status-update')).toHaveCountGreaterThan(0);
      
      // Check that status updates contain expected messages
      const statusMessages = statusUpdates.locator('.status-update');
      const statusCount = await statusMessages.count();
      
      for (let i = 0; i < statusCount; i++) {
        const message = await statusMessages.nth(i).textContent();
        console.log(`Status update ${i + 1}: ${message}`);
        
        // Verify status messages contain expected content
        expect(message).toMatch(/(starting|queued|in_progress|completed|Deep Research)/);
      }
    }
    
    // Check that markdown is properly rendered
    await expect(chatApp.locator('.markdown-content')).toBeVisible();
    
    // Check that action buttons are present
    await expect(chatApp.locator('.action-btn')).toHaveCountGreaterThan(0);
    
    console.log('✅ Progress display test completed successfully!');
  });
  
  test('handles error states with progress cleanup', async ({ page }) => {
    // Mock a failed API response
    await page.route('http://localhost:7071/api/DeepResearchFunction', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Test error' })
      });
    });
    
    await page.goto('http://localhost:3000');
    await page.waitForSelector('chat-app');
    
    const chatApp = await page.locator('chat-app');
    
    // Send a message that will fail
    await chatApp.locator('input[type="text"]').fill('test query');
    await chatApp.locator('button[type="submit"]').click();
    
    // Check that progress indicator appears initially
    await expect(chatApp.locator('.progress-message')).toBeVisible();
    
    // Wait for the error response
    await page.waitForTimeout(3000);
    
    // Check that progress message is removed and error message appears
    await expect(chatApp.locator('.progress-message')).not.toBeVisible();
    await expect(chatApp.locator('.ai-message')).toBeVisible();
    await expect(chatApp.locator('.ai-message')).toContainText('エラーが発生しました');
    
    console.log('✅ Error handling test completed successfully!');
  });
});
