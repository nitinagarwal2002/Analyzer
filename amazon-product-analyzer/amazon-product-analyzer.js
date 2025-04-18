// amazon-product-analyzer.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
// ========== CONFIG ========== #
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_PROMPT = `
You are a helpful AI assistant that analyzes product listings from provided text and extracts key information for the user.

Instructions:

1. Identify and extract the following information:
    * Product Name
    * Price(give in rupees)
    * Rating
    * User Review Summary: summarize recurring themes and sentiments.
    * Key Features/Specifications (optional but recommended)
    * Pros & Cons (optional but recommended)

2. Format the response clearly:

Example:

**Product Name:** [Name of Product]

**Price:** [Current Price] (Savings: [Percentage or Amount], Original Price: [If Available])

**Rating:** [Star Rating] out of 5 stars ([Number] ratings)

**User Review Summary:**
* ...
* ...

**Key Features/Specifications:**
* ...
* ...

**Pros:**
* ...
* ...

**Cons:**
* ...
* ...

Now here is the extracted data from an Amazon product page:
`;

// ========== SETUP ========== #
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Configure logging
const logger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`)
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Accept-Language': 'en-US,en;q=0.5'
};

// ========== FUNCTIONS ========== #
async function getHtmlData(url) {
  try {
    const response = await axios.get(url, { headers: HEADERS });
    return response.data;
  } catch (error) {
    logger.error(`Error fetching HTML: ${error.message}`);
    return null;
  }
}

function parseHtml(htmlData) {
  return htmlData ? cheerio.load(htmlData) : null;
}

function extractProductData($) {
  if (!$) {
    return null;
  }

  const productData = {};

  // Extract product name
  const productTitle = $('#productTitle').text().trim();
  productData['Product Name'] = productTitle || "N/A";

  // Extract price
  const priceWhole = $('.a-price-whole').first().text().trim();
  const priceDecimal = $('.a-price-decimal').first().text().trim();
  const priceFraction = $('.a-price-fraction').first().text().trim();
  
  if (priceWhole && priceFraction) {
    productData['Price'] = priceWhole + priceDecimal + priceFraction;
  } else if (priceWhole) {
    productData['Price'] = priceWhole;
  } else {
    productData['Price'] = "N/A";
  }

  // Extract rating
  const ratingElement = $('.a-icon-alt').first().text().trim();
  productData['Rating'] = ratingElement ? ratingElement.split(" out of ")[0] : "N/A";

  // Extract number of ratings
  const reviewsCount = $('#acrCustomerReviewText').text().trim().split(' ')[0];
  productData['Number of Ratings'] = reviewsCount || "0";

  // Extract reviews
  const reviewElements = $('.a-size-base.review-text');
  const reviews = [];
  reviewElements.each((i, el) => {
    if (i < 3) {
      reviews.push($(el).text().trim());
    }
  });
  productData['User Review Summary'] = reviews.length > 0 ? reviews : "No reviews found";

  // Extract features
  const featureElements = $('.a-list-item');
  const features = [];
  featureElements.each((i, el) => {
    if (i < 3) {
      features.push($(el).text().trim());
    }
  });
  productData['Key Features/Specifications'] = features.length > 0 ? features : "N/A";

  // Extract image URL
  const imageElement = $('#landingImage');
  productData['Image URL'] = imageElement.attr('src') || "N/A";

  // Optional pros and cons
  productData['Pros'] = "N/A";
  productData['Cons'] = "N/A";

  console.log(productData);
  return productData;
}

async function analyzeWithGemini(productData) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const inputText = GEMINI_PROMPT + "\n" + JSON.stringify(productData, null, 2);
    const result = await model.generateContent(inputText);
    const response = await result.response;
    const text = response.text();
    
    return text;
  } catch (error) {
    logger.error(`Gemini API Error: ${error.message}`);
    return "❌ Failed to analyze with Gemini.";
  }
}

// ========== ROUTES ========== #
app.post("/analyze", async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ analysis: "❌ URL is required." });
  }
  
  try {
    const html = await getHtmlData(url);
    const $ = parseHtml(html);
    const productData = extractProductData($);

    if (productData) {
      logger.info("Sending data to Gemini API for analysis...");
      const analysis = await analyzeWithGemini(productData);
      return res.json({
        analysis: analysis,
        productData: {
          "Image URL": productData["Image URL"] || "N/A"
        }
      });
    } else {
      return res.status(500).json({ analysis: "❌ Failed to extract product data." });
    }
  } catch (error) {
    logger.error(`Error in analyze endpoint: ${error.message}`);
    return res.status(500).json({ analysis: "❌ An error occurred during analysis." });
  }
});

// Start the server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

module.exports = app;