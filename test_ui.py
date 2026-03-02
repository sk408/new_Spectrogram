import asyncio
from playwright.async_api import async_playwright
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Load the local index.html file
        file_path = f"file://{os.path.abspath('index.html')}"
        await page.goto(file_path)

        # Wait a bit for the page to render
        await page.wait_for_timeout(2000)

        # We know we need to click the 'Spectrogram' h1 to start it
        await page.click('h1:has-text("Spectrogram")')
        await page.wait_for_timeout(2000)

        # Take a screenshot
        await page.screenshot(path='screenshot.png')
        await browser.close()
        print("Screenshot saved to screenshot.png")

asyncio.run(main())
