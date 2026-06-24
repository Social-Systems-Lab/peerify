# LEGACY CIRCLES DEPLOYMENT NOTE

This file was inherited from the Circles/Kamooni repository and is not the current Peerify production deployment reference.

Current Peerify deployment reference:

    cd ~/apps/peerify-app/circles
    ./scripts/deploy-peerify.sh

Verify:

    curl -fsSL https://peerify.one/api/version
    curl -I https://peerify.one/

The inherited content below is retained temporarily for reference only.

---

## **Build Docker Image**

To build a multi-platform Docker image (compatible with Raspberry Pi devices), follow these steps:

1. **Enable Buildx Driver:**

Enable the buildx driver if you haven't already done so.

```bash
docker buildx create --name mybuilder --use
```

2. **Build and push the Multi-Platform Docker Image:**

```bash
docker buildx build --platform linux/arm64,linux/amd64 -t sslorg/circles:latest --push .
```

3. **(Option B) Build a regular Docker Image:**

```bash
docker build -t sslorg/circles:latest .
```

Push the image to Docker Hub:

```bash
docker push sslorg/circles:latest
```

