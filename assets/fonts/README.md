Digital Ticket rendering uses Almarai when licensed local font files are provided.

Expected filenames:

- `Almarai-Regular.ttf`
- `Almarai-Bold.ttf`

Default env paths:

- `DIGITAL_TICKET_FONT_REGULAR_PATH=assets/fonts/Almarai-Regular.ttf`
- `DIGITAL_TICKET_FONT_BOLD_PATH=assets/fonts/Almarai-Bold.ttf`

Do not commit third-party font binaries unless the project owner has confirmed
the license permits redistribution. If either file is missing, ticket generation
continues and the renderer falls back safely.
