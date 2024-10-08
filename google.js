const fs = require('fs');
const { parse } = require('csv-parse');
const { google } = require('googleapis');
const path = require('path');

// Get the sheet ID from command line arguments
const SPREADSHEET_ID = process.argv[2];

if (!SPREADSHEET_ID) {
  console.error('Please provide a spreadsheet ID as an argument.');
  process.exit(1);
}

const RANGE = 'Sheet1!A1'; // Starting cell
const CSV_FILE_PATH = './bribe_cards.csv';
const KEY_FILE_PATH = path.join(__dirname, 'keyfile.json');

async function importCSV() {
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Read and parse CSV file
  const records = await new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(CSV_FILE_PATH)
      .pipe(parse())
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });

  // Upload to Google Sheets
  try {
    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: RANGE,
      valueInputOption: 'RAW',
      resource: { values: records },
    });

    console.log(`${response.data.updatedCells} cells updated.`);
  } catch (err) {
    console.error('Error updating spreadsheet:', err);
  }
}

importCSV();
