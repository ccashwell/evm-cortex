---
name: ipfs-deployment
description: Use when deploying dApp frontends to IPFS or decentralized hosting. Covers static builds, IPFS pinning (Pinata, Fleek), ENS content hash, trailingSlash configuration, and gateway setup.
---

# IPFS / Decentralized Frontend Deployment

## Overview

Deploying a dApp frontend to IPFS ensures censorship resistance and permanence. The frontend is served via IPFS gateways or ENS+IPFS resolution. Critical for truly decentralized protocols.

## Building for IPFS

### Next.js Static Export

```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,  // CRITICAL: IPFS serves directories, needs index.html in each
  images: {
    unoptimized: true,   // No image optimization server on IPFS
  },
  assetPrefix: './',     // Relative paths for IPFS gateway compatibility
};

module.exports = nextConfig;
```

**Why `trailingSlash: true` is critical**: IPFS resolves `/about` as a file, but `/about/` as a directory containing `index.html`. Without trailing slashes, navigation breaks on IPFS gateways.

### Vite Static Build

```typescript
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',  // Relative paths
  build: {
    outDir: 'dist',
  },
});
```

### Create React App

```json
{
  "homepage": "."
}
```

## Build and Clean

```bash
# ALWAYS clean before building for IPFS
rm -rf out/ dist/ .next/

# Build
npm run build

# Verify the output
ls -la out/  # or dist/
# Should contain index.html and all static assets
```

## IPFS Pinning

### Pinata

```bash
# Install Pinata CLI
npm install -g @pinata/cli

# Pin a directory
pinata upload ./out

# Or via API
curl -X POST "https://api.pinata.cloud/pinning/pinFileToIPFS" \
  -H "Authorization: Bearer $PINATA_JWT" \
  -F "file=@./out"
```

```typescript
// Programmatic pinning
import PinataSDK from '@pinata/sdk';

const pinata = new PinataSDK({ pinataJWTKey: process.env.PINATA_JWT });

const result = await pinata.pinFromFS('./out', {
  pinataMetadata: { name: 'my-dapp-v1.2.0' },
  pinataOptions: { cidVersion: 1 },
});

console.log('IPFS Hash:', result.IpfsHash);
// e.g., bafybeie5gq4jxvzmsym6hjlwxej4rwdoxt7wadqvmmwbqqblsm54ceyaiq
```

### Fleek

```bash
# Install Fleek CLI
npm install -g @fleek-platform/cli

# Login
fleek login

# Deploy
fleek sites deploy --dir ./out
```

### IPFS CLI (Direct)

```bash
# Add to local IPFS node
ipfs add -r ./out --cid-version 1
# Returns CID: bafybeie5gq4jxvzmsym6hjlwxej4...

# Pin to remote pinning service
ipfs pin remote add --service=pinata bafybeie5gq4jxvzmsym6hjlwxej4...
```

## ENS Content Hash

Link your IPFS deployment to an ENS name for `myprotocol.eth` resolution:

```typescript
import { createWalletClient, http, namehash } from 'viem';
import { mainnet } from 'viem/chains';

const ENS_RESOLVER = '0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63';

// Set content hash to IPFS CID
const contentHash = encodeContentHash('ipfs://bafybeie5gq4jxvzmsym6hjlwxej4...');

await walletClient.writeContract({
  address: ENS_RESOLVER,
  abi: resolverAbi,
  functionName: 'setContenthash',
  args: [namehash('myprotocol.eth'), contentHash],
});
```

Using ethers.js:

```typescript
import { ethers } from 'ethers';

const resolver = await provider.getResolver('myprotocol.eth');
const tx = await resolver.setContentHash('ipfs://bafybeie5gq4jxvzmsym6hjlwxej4...');
await tx.wait();
```

Access via: `https://myprotocol.eth.limo` (ETH.limo gateway)

## Gateway Configuration

### Public IPFS Gateways

| Gateway | URL Pattern |
|---------|-------------|
| Cloudflare | `https://cloudflare-ipfs.com/ipfs/{cid}` |
| dweb.link | `https://{cid}.ipfs.dweb.link` |
| eth.limo | `https://{ens}.eth.limo` (ENS resolution) |
| Pinata | `https://gateway.pinata.cloud/ipfs/{cid}` |
| w3s.link | `https://{cid}.ipfs.w3s.link` |

### Custom Gateway (Pinata Dedicated)

```bash
# Pinata dedicated gateway
https://your-gateway.mypinata.cloud/ipfs/{cid}
```

## CI/CD Pipeline

```yaml
# .github/workflows/deploy-ipfs.yml
name: Deploy to IPFS
on:
  push:
    tags: ['v*']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run build

      - name: Pin to Pinata
        env:
          PINATA_JWT: ${{ secrets.PINATA_JWT }}
        run: |
          CID=$(npx @pinata/cli upload ./out --json | jq -r '.IpfsHash')
          echo "Deployed to IPFS: $CID"
          echo "Gateway: https://gateway.pinata.cloud/ipfs/$CID"
          echo "CID=$CID" >> $GITHUB_ENV

      - name: Update ENS (optional)
        if: github.ref_type == 'tag'
        env:
          DEPLOYER_KEY: ${{ secrets.ENS_DEPLOYER_KEY }}
        run: |
          # Update ENS content hash via script
          node scripts/update-ens.js ${{ env.CID }}
```

## Deployment Checklist

- [ ] Clean build directory before building (`rm -rf out/ dist/ .next/`)
- [ ] `trailingSlash: true` in Next.js config (required for IPFS routing)
- [ ] `output: 'export'` for static generation (no SSR on IPFS)
- [ ] Relative asset paths (`./` or `assetPrefix: './'`)
- [ ] No server-side features (API routes, middleware, SSR)
- [ ] Images unoptimized (`images.unoptimized: true`)
- [ ] RPC URLs configured via environment or hardcoded public RPCs
- [ ] Test locally: `npx serve out` and verify all routes work
- [ ] Pin to at least 2 pinning services for redundancy
- [ ] Update ENS content hash after pinning
- [ ] Verify via public gateway before announcing
- [ ] Store CID in deployment registry / release notes

## Common Pitfalls

1. **Missing `trailingSlash: true`**: Pages return 404 on IPFS
2. **Absolute paths (`/assets/...`)**: Break on IPFS subpath gateways
3. **SSR/API routes**: Don't work on IPFS (static only)
4. **Image optimization**: Next.js image optimizer needs a server
5. **Client-side routing**: Works with hash router, needs `trailingSlash` for path router
6. **Stale cache**: Always clean build before deploying
7. **Large bundles**: IPFS retrieval is slower than CDN — optimize bundle size
