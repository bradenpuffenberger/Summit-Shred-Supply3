# Summit Shred Admin Setup

Use this when you want one account to review listing reports.

## What Changed

- The Amplify auth resource creates a Cognito group named `Admin`.
- `admin.html` shows the report queue only to users in that group.
- Admins can mark reports `OPEN`, `REVIEWED`, or `RESOLVED`.
- Admins can hide a reported listing from the report queue.

## Create Your Admin Account

1. Deploy or run the updated Amplify backend so the `Admin` group and report permissions exist.

   ```powershell
   npm run sandbox
   ```

   For production, use your normal Amplify backend deploy.

2. Create your user account from `/auth.html` like any normal user.

3. Add that user to the Cognito `Admin` group.

   AWS CLI:

   ```powershell
   aws cognito-idp admin-add-user-to-group --user-pool-id <your-user-pool-id> --username <your-email> --group-name Admin
   ```

   AWS Console:

   - Open Amazon Cognito.
   - Open the Summit Shred user pool.
   - Open `Groups` and confirm `Admin` exists.
   - Open `Users`, choose your user, and add them to `Admin`.

4. Sign out and sign back in so Cognito issues a fresh token with the `Admin` group claim.

5. Open `/admin.html` or use the `Admin` button in the marketplace header.

## Notes

- Group name is case-sensitive: use `Admin`.
- If the admin page says your groups are `none`, sign out and sign in again after adding the group.
- Reports are stored as `ListingReport` records in the Amplify Data API.
