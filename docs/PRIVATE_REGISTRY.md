# Private Registry Setup

The `@devnw/components` (SPYDER) component library is published to the GitLab Package Registry as a private package. This guide covers how to configure npm to access it.

## Overview

The project's `.npmrc` file is pre-configured to route `@devnw/*` package requests to the GitLab registry. You need to provide authentication credentials.

## Local Development Setup

### Step 1: Create a GitLab Personal Access Token

1. Go to [GitLab > Preferences > Access Tokens](https://gitlab.com/-/user_settings/personal_access_tokens)
2. Create a new token with:
   - **Name**: `npm-registry` (or any descriptive name)
   - **Scopes**: `read_api` (minimum required)
   - **Expiration**: Set a reasonable expiration date
3. Copy the generated token

### Step 2: Configure Authentication

**Option A: Global ~/.npmrc (Recommended for personal machines)**

Add the token to your global npmrc so it works across all projects:

```bash
echo "//gitlab.com/api/v4/packages/npm/:_authToken=YOUR_TOKEN_HERE" >> ~/.npmrc
```

**Option B: Environment Variable**

Set the token as an environment variable in your shell profile:

```bash
# Add to ~/.zshrc or ~/.bashrc
export GITLAB_NPM_TOKEN="YOUR_TOKEN_HERE"
```

Then reference it in the project `.npmrc`:

```ini
@devnw:registry=https://gitlab.com/api/v4/packages/npm/
//gitlab.com/api/v4/packages/npm/:_authToken=${GITLAB_NPM_TOKEN}
```

### Step 3: Verify Access

```bash
# Should list available versions
npm view @devnw/components versions

# Install the package
npm install @devnw/components
```

## CI/CD Configuration

In GitLab CI, authentication is handled automatically via `CI_JOB_TOKEN`. The pipeline's `before_script` configures this:

```yaml
before_script:
  - |
    echo "@devnw:registry=https://gitlab.com/api/v4/packages/npm/" >> ~/.npmrc
    echo "//gitlab.com/api/v4/packages/npm/:_authToken=${CI_JOB_TOKEN}" >> ~/.npmrc
```

No additional configuration is needed for CI/CD pipelines.

## Troubleshooting

### `401 Unauthorized` during `npm install`

- Verify your token has `read_api` scope
- Check that the token hasn't expired
- Ensure the token is in `~/.npmrc` (not the project `.npmrc`)

### `404 Not Found` for `@devnw/components`

- Verify you have access to the `devnw/react/components` GitLab project
- Check that the package has been published: visit the project's Package Registry page

### Token Security

- **Never commit tokens** to `.npmrc` in the repository
- The project `.npmrc` only contains the registry URL, not the token
- Use `~/.npmrc` (global) or environment variables for token storage
- Rotate tokens periodically
- Use tokens with minimal required scopes (`read_api`)

## Using Specific Versions

```bash
# Install latest stable
npm install @devnw/components@latest

# Install specific version
npm install @devnw/components@0.1.1

# Install dev build (latest from main branch)
npm install @devnw/components@dev

# Install release candidate
npm install @devnw/components@next
```

## Dist Tags

| Tag | Description |
|-----|-------------|
| `latest` | Latest stable release (from `vX.Y.Z` tags) |
| `dev` | Latest build from `main` branch |
| `next` | Release candidates (`vX.Y.Z-rc.N` tags) |
