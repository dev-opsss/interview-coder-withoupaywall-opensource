# Setting up Google Cloud Speech-to-Text API

This document explains how to set up the Google Cloud Speech-to-Text API for use with the application.

## Prerequisites

1. A Google Cloud Platform account. If you don't have one, you can sign up at https://cloud.google.com/

## Step 1: Create a Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown menu at the top of the page
3. Click "New Project"
4. Enter a project name and click "Create"

## Step 2: Enable the Speech-to-Text API

1. Go to the [API Library](https://console.cloud.google.com/apis/library)
2. Search for "Speech-to-Text"
3. Click on "Cloud Speech-to-Text API"
4. Click "Enable"

## Step 3: Create an API Key

1. Go to the [Credentials](https://console.cloud.google.com/apis/credentials) page
2. Click "Create Credentials" and select "API key"
3. Your new API key will be displayed
4. Copy this key and store it securely

### Restrict Your API Key (Recommended)

For security reasons, it's recommended to restrict your API key:

1. On the Credentials page, find your API key and click "Edit API key"
2. Under "API restrictions", select "Restrict key"
3. Select "Cloud Speech-to-Text API" from the dropdown
4. Click "Save"

## Step 4: Configure the Application

1. Open the application settings
2. Select "Google Cloud Speech-to-Text" as your Speech Service
3. Paste your API key in the "Google Cloud Speech-to-Text API Key" field
4. Click "Test API Key" to verify your key works
5. Save your settings

## Troubleshooting

If you encounter issues with your API key:

1. Ensure the Speech-to-Text API is enabled for your project
2. Check that your API key has not expired or been revoked
3. Verify that you've copied the entire API key correctly
4. Ensure your Google Cloud account has billing enabled (required for API usage)
5. Check your quota limits in the Google Cloud Console

## Pricing Information

Google Cloud Speech-to-Text API is a paid service. You can find the current pricing information at [Google Cloud Speech-to-Text Pricing](https://cloud.google.com/speech-to-text/pricing).

The application uses the following settings:
- Model: default
- Sample Rate: 16000 Hz (resampled from your microphone)
- Audio Format: LINEAR16 (PCM)
- Language: English (en-US)

For most usage, the costs should be minimal, but you should monitor your usage in the Google Cloud Console to avoid unexpected charges. 