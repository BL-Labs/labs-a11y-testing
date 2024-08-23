/*
   Accesibility Checker for whole site - a11ychecker.mjs
   Liam Green-Hughes
   British Library
   2024
*/

import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import { URL } from 'url';
import fs from 'fs';
import { promisify } from 'util';
import xml2js from 'xml2js';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';

// Converts a time stamp into a string suitable for use in a directory name
function getDateBasedDirName(date) {
  const padZero = n => `${n}`.padStart(2, '0');
  return `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())}` +
         `T${padZero(date.getHours())}-${padZero(date.getMinutes())}-${padZero(date.getSeconds())}`;
}

// Gets the path to write the Lighthouse reports to, based on the current timestamp.
// Creates directory if missing.
function getReportsDir() {
  // Convert __dirname to work with ES modules
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
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
  if (url == null || url == "")
  {
    throw new Error("No URL supplied to run Lighthouse");
  }
  console.log("Running Lighthouse tests on: " + url);
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
    console.log('  - No cookie consent banner found or failed to dismiss.');
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

// Works through the entries in a sitemap.xml file, testing any URLs it finds
// Copes recursively with embedded sitemaps also.
async function processSitemap(reportsDir, url) {
  const response = await axios.get(url);
  
  const parser = new xml2js.Parser();
  const parseString = promisify(parser.parseString);

  const sitemap = await parseString(response.data);

  if (sitemap.urlset) {
    const urls = sitemap.urlset.url.map(entry => entry.loc[0]);
    for (const url of urls) {
      await runLighthouse(reportsDir, url);
    }
  } else if (sitemap.sitemapindex) {
    const sitemaps = sitemap.sitemapindex.sitemap.map(entry => entry.loc[0]);
    for (const sitemapUrl of sitemaps) {
      if (sitemapUrl.includes('sitemap') && sitemapUrl.endsWith('.xml')) {
        await processSitemap(reportsDir, sitemapUrl);
      }
    }
  }
}

// Converts a directory path back to a timestamp
function getReportTimeFromDirectoryPath(directory)
{ 
  let parts = path.basename(directory).split("T");
  return parts[0] + "T" + parts[1].replace("-", ":") + "Z";
}

// Reads in data from an individual Lighthouse JSON output file
function extractPageData(data)
{
  let pageData = {"score":0, "audits": {}};
  // Check if 'categories' and 'accessibility' exist
  let pageUrl = new URL(data.requestedUrl);
  pageData["path"] = pageUrl.pathname;
  if ('categories' in data && 'accessibility' in data.categories) 
  {
    const scoreElement = data.categories.accessibility;
                  
    // If 'score' exists, add it to the total and increment count
    if ('score' in scoreElement) {
      pageData["score"] = parseFloat(scoreElement.score);
    }
  }
  else 
  {
    console.log(`No valid structure found for ${filename}.`);
  }
  // extract individual warnings
  for (var auditKey in data.audits)
  {
    if(isIncludableInReport(data.audits[auditKey]))
    {
       pageData["audits"][auditKey]= data.audits[auditKey];
    }
  }
  return pageData;
}

// Determines if an audit should be included in the report
function isIncludableInReport(auditData)
{
  return (auditData.scoreDisplayMode != "notApplicable" 
    && (auditData.scoreDisplayMode == "binary" && auditData.score == 0) 
    && auditData.scoreDisplayMode != "informative" 
    && auditData.scoreDisplayMode != "manual");
}

// Produces data for entire report by combining information from each Lighthouse run
function generateReportData(url, directory) 
{
  let site_url = new URL(url);

  let reportData = {"page_scores": {}, "page_audits": {}};
  reportData["host"] = site_url.host;

// Check if the directory exists
  if (!fs.existsSync(directory)) {
      console.log("The specified directory does not exist.");
      return null;
  }

  let totalScore = 0;
  let count = 0;

  const files = fs.readdirSync(directory);
  for (const filename of files) {
      if (filename.endsWith(".json")) {
        
          try {
              const filepath = path.join(directory, filename);
              const pageData = extractPageData(JSON.parse(fs.readFileSync(filepath, 'utf8')));
              count++;
              totalScore += pageData["score"];
              reportData["page_scores"][pageData["path"]] = pageData["score"];
              reportData["page_audits"][pageData["path"]] = pageData["audits"];
          } catch (error) {
              console.error(`Failed to parse JSON in ${filename}: ${error}`);
          }
      }
  }

  // Calculate average; avoid division by zero error
  if (count > 0) {
      const average = totalScore / count;
      reportData["site_average"] = average;
      reportData["report_datetime"] = getReportTimeFromDirectoryPath(directory);
      return reportData;
  } else {
      console.log("No scores found.");
      return null;
  }
}

// Converts a pagename into a string suitable for use in an internal link
function makeAnchorFromPageName(pageName)
{
  return pageName.replaceAll("/","");
}

// Produces HTML for page-by-page scores for accessibility
function outputPageScores(pageScores)
{
  let html = "";
  for (var page in pageScores)
  {
    // We only want to see pages needing work
    if (pageScores[page] == 1)
    {
      continue;
    }
    html += "<tr><th><a href='#" + makeAnchorFromPageName(page) + "'>" + page + "</a></th><td>" + formatPercent(pageScores[page]) + "</td></tr>";

  }
  return html;
}

// turn markdown style links to HTML
function linkify(text)
{
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/;
  const match = text.match(regex);
  if (!match)
  {
    return text;
  }
  const label = match[1];  // Text inside square brackets
  const url = match[2];    // URL inside parentheses

  // Constructing the HTML <a> tag
  const htmlTag = "<a target='_blank' href='" + url + "'>" + label + "</a>";
  return text.replace(match[0], htmlTag);
}

// Converts HTML so it can be shown without being interpreted by the browser
function escapeHTML(html) {
  return html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
}

// Outputs HTML for instamce of an audit warning
function outputAuditItem(fItem)
{
  let html = "<table class='f-item'>";
  html += "<tr><th>Selector</th><td><pre>" + fItem["node"]["selector"] + "</pre></td></tr>";
  html += "<tr><th>Snippet</th><td><code>" + escapeHTML(fItem["node"]["snippet"]) + "</code></td></tr>";
  html += "<tr><th>Explanation</th><td>" + fItem["node"]["explanation"] + "</td></tr>";

  html += "</table>";
  return html;
}

// Creates HTML for page level audit items 
function outputPageAudits(pageAudits)
{
  let html = "";
  for (var page in pageAudits)
  {
    if (Object.keys(pageAudits[page]).length == 0)
    {
      continue;
    }
    html += "<h3 class='ifpt'><a id='" + makeAnchorFromPageName(page) + "'>" + page + "</a></h3>";
    for (var audit in pageAudits[page])
    {
      var item = pageAudits[page][audit];
      html += "<div id='audit-" + item["id"] + "' class='audit-item'>";
      html += "<h4>" + item["title"] + "</h4>";
      html += "<p>" + linkify(item["description"]) + "</p>";
      if (item["details"])
      {
        html += "<h5>Nodes affected</h5>";
        for (var f_item in item["details"]["items"])
        {
          html += outputAuditItem(item["details"]["items"][f_item]);
        }
      }
      html += "</div>";
    }

  }

  return html;
}

// formats a decimal as a percentage with two decimal places
function formatPercent(number)
{
  return (number*100).toFixed(2) + "%";
}

// Fills in templates (using report_templates.html) and writes report to disc
function outputSummaryReport(reportsDir, reportData)
{
  let content = fs.readFileSync('report_template.html', 'utf8');
  content = content.replaceAll("%siteName%", reportData["host"]);
  content = content.replaceAll("%site_average%", formatPercent(reportData["site_average"]));
  content = content.replaceAll("%report_datetime%", reportData["report_datetime"]);
  content = content.replaceAll("%page_scores%", outputPageScores(reportData["page_scores"]));
  content = content.replaceAll("%page_audits%", outputPageAudits(reportData["page_audits"]));  
  
  const reportPath = path.join(reportsDir, "report.html")
  try {
      fs.writeFileSync(reportPath, content, 'utf8');
      console.log("File written successfully.");
  } catch (err) {
      console.error("Error writing to file:", err);
  }
  return reportPath;
}

  

// ** MAIN **
async function main() {
  const url = process.argv[2];
  const reportsDir = getReportsDir();
  if (!url) {
    console.error('Please provide a URL as a parameter.');
    process.exit(1);
  }

  if (url.endsWith('.xml')) {
    await processSitemap(reportsDir, url);
  } else {
    await runLighthouse(reportsDir, url);
  }
  
  // generate summary data
  let reportData = generateReportData(url, reportsDir);
  // output the report data to HTML
  console.log("Generating report...");
  let reportPath = outputSummaryReport(reportsDir, reportData);
  console.log("Finished. Report available at: " + reportPath);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
