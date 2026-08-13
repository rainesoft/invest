# Raine Bank Developer Setup

This guide outlines the steps required to set up your local environment for developing and running the Raine Bank system.

## 1. Prerequisites

Ensure you have a terminal open and `curl` installed (which is included by default on macOS).

## 2. Install Node.js (via NVM)

We recommend using Node Version Manager (NVM) to manage your Node.js installations.

1. Install NVM:
   ```bash
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   ```
2. Restart your terminal, or load NVM manually:
   ```bash
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
   ```
3. Install and use Node.js (v20+ recommended):
   ```bash
   nvm install 20
   nvm use 20
   ```

## 3. Install pnpm

`pnpm` is the package manager used in this workspace.

Once Node.js is installed, you can install pnpm globally via npm:
```bash
npm install -g pnpm
```

## 4. Install Deno

Deno is used to run the Supabase Edge Functions in this project.

Install Deno using the official script:
```bash
curl -fsSL https://deno.land/install.sh | sh
```

Make sure to add Deno to your PATH if the installer prompts you to (usually by adding it to your `~/.zshrc` or `~/.bashrc`):
```bash
export DENO_INSTALL="$HOME/.deno"
export PATH="$DENO_INSTALL/bin:$PATH"
```

## 5. Install the Supabase CLI

The Supabase CLI is required to manage and deploy edge functions (like `agent-trade`).

**For macOS (Recommended):**
Install the CLI via Homebrew:
```bash
brew install supabase/tap/supabase
```

**For Windows/Linux (or via npm):**
```bash
npm install -g supabase
```

## 6. Setup the Project & Authenticate

Once the tools above are installed, you can set up the project:

1. Install all Node dependencies using `pnpm`:
   ```bash
   pnpm install
   ```
2. Authenticate the Supabase CLI with your account:
   ```bash
   supabase login
   ```
   *(This will prompt you to generate and provide a Personal Access Token from your dashboard).*
3. Link your local project to the production Supabase instance (replace `<project-id>` with your actual ID, e.g., `ktezlusdkqlfdwqrldtn`):
   ```bash
   supabase link --project-ref <project-id>
   ```
4. For Edge Function deployment, you can now use:
   ```bash
   supabase functions deploy <function-name>
   ```
   *(Alternatively, use `pnpm deploy:prod` to push both DB changes and edge functions).*

You are now ready to develop on the Raine Bank system!
