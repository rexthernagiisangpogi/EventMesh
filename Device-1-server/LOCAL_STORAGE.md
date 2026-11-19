# Local database

The server stores event, seat, ticket, and entry-log data in SQLite on Laptop 1.

## Configure storage

The default database file is `laptop1-server/data/eventmesh.sqlite`. To store it
elsewhere, set `EVENTMESH_DATA_DIR` in the server's `.env` file to the directory
where the database file should be created. Keep this directory on a local disk
accessible to the server process; do not put the database on a shared network
filesystem.

Set `HMAC_SECRET` in the server's `.env` file to a private, stable value. It is
used to sign ticket payloads and must not be added to client bundles or source
control.

## Back up data

Stop the server before copying `eventmesh.sqlite` for a backup. Keep backups
private because ticket and attendee information is stored in the database.
Restore by placing the database file back in the configured data directory
while the server is stopped.

Laptops 2, 3, and 4 continue to access the data only through the Laptop 1 server
API. The browser clients do not open the SQLite database directly.

Existing data from a previous cloud database is not copied automatically. The
local database starts empty; the cloud project and its existing data are left
unchanged.
