# Firestore setup

The server uses the Firebase Admin SDK and Cloud Firestore. Browser clients
continue to communicate with the server API; Firebase credentials must never
be added to the client bundle or committed to source control.

## Configure credentials

1. Create a Firebase project and enable Cloud Firestore.
2. Provide Application Default Credentials to the server. For local
   development, set `GOOGLE_APPLICATION_CREDENTIALS` in `server/.env` to the
   absolute path of a service-account JSON file. Keep that file outside this
   repository. In a managed Google Cloud environment, use the runtime's
   attached service account instead.
3. Set `FIREBASE_PROJECT_ID` in `server/.env` to the Firebase project ID.
4. The default server port is `5001`. Set `PORT` in `server/.env` if you need
   another port.
5. Install server dependencies with `npm install` in `server/`, then start it
   with `npm start`.

For client terminals, set `REACT_APP_SERVER_IP` to the server's LAN address
and, if using a non-default server port, set `REACT_APP_SERVER_PORT` to match.

The server requires Admin credentials and bypasses Firestore Security Rules.
The checked-in rules deny direct client access; keep data access behind the
server API.

## Deploy Firestore rules and indexes

From the repository root, run:

```sh
firebase deploy --only firestore:rules,firestore:indexes
```

The lock reaper uses a composite index on seat `status` and `lock_expiration`,
defined in `firestore.indexes.json`.

## Collections

Create the initial seat documents in the `seats` collection before opening
ticket sales. Use each `seat_id` as the Firestore document ID. A seat document
has this shape:

```json
{
  "row_number": 1,
  "seat_number": 1,
  "status": "AVAILABLE",
  "locked_by": null,
  "lock_expiration": null
}
```

Seat IDs must not contain `:` because that character separates fields in the
signed ticket payload. The server creates documents in `tickets` and
`entry_logs` as bookings and online validations occur.
