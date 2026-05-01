# Setting Up Amazon Cognito with Amplify Gen 2

## Prerequisites (Windows)

1. **Node.js 18+** - Download from https://nodejs.org (LTS version)
2. **AWS Account** - Create one at https://aws.amazon.com
3. **AWS Credentials** - Configure in AWS CLI
4. **PowerShell or Command Prompt**

## Step 1: Verify Node.js Installation

**Open PowerShell and check if Node.js is installed:**

```powershell
node --version
npm --version
```

If these show version numbers, go to Step 2. If not, download Node.js from https://nodejs.org (then restart PowerShell).

## Step 2: Install Amplify CLI (Gen 2)

```powershell
npm install -g @aws-amplify/cli@latest
```

**Verify installation:**

```powershell
amplify --version
```

## Step 3: Configure AWS Credentials

```powershell
aws configure
```

Enter your AWS Access Key ID, Secret Access Key, region (e.g., `us-east-1`), and output format (`json`).

## Step 4: Initialize Amplify Gen 2 in Your Project

**Navigate to your project folder:**

```powershell
cd c:\Users\brade\Documents\GitHub\Summit-Shred-Supply
```

**Initialize Amplify (choose Gen 2 when prompted):**

```powershell
amplify init
```

Follow the prompts:
- Project name: `summitshredsupply`
- Environment: `dev`
- Description: Leave blank or add one
- Choose authentication method: Select your AWS profile
- When asked "Use Amplify Gen 2 template?": **Select Yes**

## Step 5: Add Authentication to Your Backend

```powershell
amplify add auth
```

Follow the prompts:
- Authentication method: **User name**
- MFA: **Optional** (choose your preference)
- User attributes to sign up: **Email**
- Allow unauthenticated identities: **No**
- Configure advanced settings: **No**

## Step 6: Deploy Your Backend

```powershell
amplify push
```

This creates your Cognito User Pool and generates configuration files.

## Step 7: Install Amplify Libraries

```powershell
npm install aws-amplify @aws-amplify/ui-react
```

## Step 8: Get Your Configuration

Your configuration is automatically generated in `amplifyconfiguration.json`. The auth.js file will use this.

## Step 9: Update auth.js with Gen 2 Code

The auth.js file has been updated to use Amplify Gen 2. No manual updates needed.

## Step 10: Test Your Setup

1. Commit changes:
   ```powershell
   git add .
   git commit -m "Add Amplify Gen 2 auth setup"
   git push
   ```

2. Redeploy to Amplify Hosting
3. Visit your site and test login/signup

## Troubleshooting (Windows)

### "amplify: command not found"
- Install Amplify CLI: `npm install -g @aws-amplify/cli@latest`
- Close and reopen PowerShell

### "AWS credentials not found"
- Run: `aws configure`
- Enter your AWS Access Key ID and Secret Access Key

### "User Pool not created"
- Make sure `amplify push` completed successfully
- Check AWS Console → Cognito → User Pools to verify

### Files not generating
- Delete `.amplify` folder
- Run `amplify init` again

For more info: https://docs.amplify.aws/gen2/deploy-and-host/fullstack-branching/

