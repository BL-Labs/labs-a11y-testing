# labs-a11y-testing

This script runs Lighthouse accessibility tests on every page in a website and generates a report for the whole site.

To install:
```
npm install
```

To use, you need to find the sitemap for your website. The script will use this to visit every page in your site. This is the same sitemap url that you would submit to Google Search Console.

This is an example of how to invoke the script:
```
node .\a11checker.mjs https://example.com/sitemap.xml
```
