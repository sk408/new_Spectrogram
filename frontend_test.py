from playwright.sync_api import sync_playwright
import os

def run_test():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Load local HTML file
        file_path = f"file://{os.path.abspath('index.html')}"
        page.goto(file_path)

        # Take screenshot
        page.screenshot(path="screenshot.png")
        print("Frontend verification screenshot taken.")

        browser.close()

if __name__ == '__main__':
    run_test()
