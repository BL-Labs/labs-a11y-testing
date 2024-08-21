import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import { URL } from 'url';
import fs from 'fs';
import { promisify } from 'util';
import xml2js from 'xml2js';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

function getDateBasedDirName(date) {
  const padZero = n => `${n}`.padStart(2, '0');
  return `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())}` +
         `T${padZero(date.getHours())}-${padZero(date.getMinutes())}-${padZero(date.getSeconds())}`;
}

function getReportsDir() {
  // Convert __dirname to work with ES modules
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // const parser = new xml2js.Parser();
  // const parseString = promisify(parser.parseString);
  // Create reports directory if not exist
  const now = new Date();
  // Create the reports directory using a date-based naming convention
  const reportsDir = path.join(__dirname, 'reports', getDateBasedDirName(now) ); // Use the current date to create a unique subdirectory for each day's reports
  if (!fs.existsSync(reportsDir)) {
    // If the directory does not exist, create it using the `mkdirSync` method
    fs.mkdirSync(reportsDir);
  }
  return reportsDir;
}
// This function takes a URL path and sanitizes it by replacing any special characters with underscores
function sanitizeFilename(urlPath) {
  // Use a regular expression to match any special characters (e.g. /, ?, :, #, etc.) and replace them with an underscore
  return urlPath.replace(/[\/:?#\[\]@!$&'()*+,;=]/g, '_');
}

/**
 * Run Lighthouse on a given URL.
 *
 * This function takes a URL and runs Lighthouse on it, generating an accessibility report.
 * It uses Puppeteer to launch a headless browser instance and navigate to the provided URL.
 * The `lighthouse` function is used to run the audit and generate the report.
 *
 * @param {string} url - The URL to run Lighthouse on.
 */
async function runLighthouse(reportsDir, url) {
  // Launch a new Puppeteer browser instance
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url);

  // Handle cookie consent (modify the selector based on your site's cookie consent button)
  try {
    if (!url.endsWith(".xml"))
    {
      // Click the cookie consent button
      await page.click('#ccc-close'); // Adjust the selector as per your cookie consent button
    }
  } catch (e) {
    console.log('No cookie consent banner found or failed to dismiss:');
    console.log(url);
    console.log("===");
  }

  // Get the Lighthouse report
  const port = new URL(browser.wsEndpoint()).port;
  const result = await lighthouse(url, {
    port,
    onlyCategories: ['accessibility'],
    output: 'json',
  });

  // Get the report JSON
  const reportJson = result.report;
  const urlObj = new URL(url);
  const sanitizedPath = sanitizeFilename(urlObj.pathname);
  const reportPath = path.join(reportsDir, `${sanitizedPath}.json`);
  
  // Save the report to a file
  fs.writeFileSync(reportPath, reportJson);

  // Close the browser instance
  await browser.close();
}

async function processSitemap(url) {
  const response = await axios.get(url);
  const sitemap = await parseString(response.data);

  if (sitemap.urlset) {
    const urls = sitemap.urlset.url.map(entry => entry.loc[0]);
    for (const url of urls) {
      await runLighthouse(url);
    }
  } else if (sitemap.sitemapindex) {
    const sitemaps = sitemap.sitemapindex.sitemap.map(entry => entry.loc[0]);
    for (const sitemapUrl of sitemaps) {
      if (sitemapUrl.includes('sitemap') && sitemapUrl.endsWith('.xml')) {
        await processSitemap(sitemapUrl);
      }
    }
  }
}

function calculateAverageScore(directory) {
  console.log(directory);  


// Check if the directory exists
  if (!fs.existsSync(directory)) {
      console.log("The specified directory does not exist.");
      return null;
  }

  let totalScore = 0;
  let count = 0;

  const files = fs.readdirSync(directory);
  for (const filename of files) {
    console.log(filename);
      if (filename.endsWith(".json")) {
        
          try {
              const filepath = path.join(directory, filename);
              const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
              
              // Check if 'categories' and 'accessibility' exist
              if ('categories' in data && 'accessibility' in data.categories) {
                  const scoreElement = data.categories.accessibility;
                  
                  // If 'score' exists, add it to the total and increment count
                  if ('score' in scoreElement) {
                      totalScore += parseInt(scoreElement.score);
                      count++;
                  }
              } else {
                  console.log(`No valid structure found for ${filename}.`);
              }
          } catch (error) {
              console.error(`Failed to parse JSON in ${filename}: ${error}`);
          }
      }
  }

  // Calculate average; avoid division by zero error
  if (count > 0) {
      const average = totalScore / count;
      return average;
  } else {
      console.log("No scores found.");
      return null;
  }
}

async function main() {
  const url = process.argv[2];
  const reportsDir = "C:\\Users\\liam\\OneDrive\\Documents\\BritishLibrary\\src\\labswebtesting\\reports\\2024-07-24T10-34-20"; //getReportsDir();
  if (!url) {
    console.error('Please provide a URL as a parameter.');
    process.exit(1);
  }

  if (url.endsWith('.xml')) {
    // await processSitemap(url);
  } else {
    // await runLighthouse(reportsDir, url);
  }
  
  console.log(calculateAverageScore(reportsDir));

}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
