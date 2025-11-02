# C2PA-enabled Statusphere fork for authenticity verification

An example application covering:

- Signin via OAuth
- Fetch information about users (profiles)
- Listen to the network firehose for new data
- Publish data on the user's account using a custom schema
- **Real posts with images and external links**
- **C2PA content credentials validation for images**

See https://atproto.com/guides/applications for a guide through the codebase.

## Features

### Core AT Protocol Features
- OAuth authentication with Bluesky
- Profile management
- Real-time firehose integration
- Custom lexicon schemas

### Enhanced Social Features
- **Post Composer**: Create posts with text, images, and external links
- **Image Upload**: Upload and display images via AT Protocol blobs
- **External Link Embeds**: Share links with previews
- **Timeline**: Unified view of posts and status updates
- **Mentions & Hashtags**: Rich text formatting

### Content Credentials (C2PA)
- **Image Validation**: Check C2PA content credentials in uploaded images
- **Metadata Display**: View detailed information about image provenance
- **Trust Indicators**: Visual indicators for validated content

## Getting Started

```sh
git clone https://github.com/bluesky-social/statusphere-example-app.git
cd statusphere-example-app
cp .env.template .env
npm install
npm run dev
# Navigate to http://localhost:8080
```

## Configuration

### Basic Setup
Edit your `.env` file with the basic configuration as shown in `.env.template`.

### C2PA Content Credentials (Optional)
To enable C2PA validation for images, configure the following environment variables:

```bash
# C2PA Content Credentials API
C2PA_API_ENDPOINT="https://your-c2pa-api.com/manifests/validate"
C2PA_API_KEY="your-api-key-if-required"
```

The C2PA validation feature will:
1. Show an info button (ℹ️) on images in the timeline
2. When clicked, fetch the image and convert it to base64
3. Send a POST request to your C2PA API endpoint with the format:
   ```json
   {
     "fileData": "base64EncodedString",
     "format": "image/jpeg"
   }
   ```
4. Display the validation results in a modal dialog

If no C2PA API is configured, the info button will still appear but will show an error message when clicked.
