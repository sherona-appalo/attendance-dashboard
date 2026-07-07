# Biometric Attendance Dashboard

A web-based attendance management dashboard that consolidates attendance records from multiple biometric sources into a single interface. The application provides real-time attendance insights, employee lookup, day-wise attendance monitoring, comprehensive reporting, and local PC-server-based data storage.

## Features

**Dashboard**
- Attendance summary cards
- Employee attendance table
- Advanced search and filters
- Team-based filtering
- Face, Fingerprint, Great HR mode tabs
- Cross-mode First In, Last Out, and Working Hours calculation
- 12-hour (AM/PM) time display

**Employee Lookup**
- Search by Employee ID or Employee Name
- Complete attendance history
- Attendance mode usage statistics
- Daily punch details
- Working hours analysis
- Employee ID-based matching, so an employee's records merge correctly even if their name is spelled differently across sources

**View by Date**
- View attendance for any selected date
- Present, Absent, and Weekend status
- First In, Last Out, and Working Hours
- Team filtering
- Attendance mode filtering

**Reports**
- Attendance Summary
- Late Login Report
- Early Login Report
- Overtime Report
- Insufficient Hours Report
- Missing Checkout Report
- Absent Employees Report
- Single Punch Report
- Fingerprint Without Face / Face Without Fingerprint Report
- Duplicate Punch Report
- Multiple Punch Report
- Attendance Pattern Report
- Attendance Source Comparison Report
- Excel export and print (CSV export removed)

**Import Centre**
- Upload Face attendance data
- Upload Fingerprint attendance data
- Upload Great HR attendance data
- Upload Employee Master
- Automatic merging of uploaded data
- Duplicate prevention
- Local PC server storage (no cloud account required)
- Six-month automatic attendance data retention (Employee Master is never affected)

## Attendance Logic

The dashboard combines attendance data from all available sources:
- Face Recognition
- Fingerprint Devices
- Great HR

For every employee and date:
- **First In** = Earliest punch across all attendance sources
- **Last Out** = Latest punch across all attendance sources
- **Working Hours** = Last Out - First In
- Attendance mode tabs only filter *displayed* punches and never change the underlying attendance calculations

**Employee matching**
- Employees are matched primarily by **Employee ID**, not by name -- this ensures the same person is recognized correctly even when their name is entered differently across Face, Fingerprint, and Great HR (e.g. "Dhamodharan G" vs "Dhamodharan Gopal")
- Numeric Employee IDs are normalized so that leading-zero variants (e.g. "076" and "76") are always treated as the same person

**Absent logic**
- Employees with at least one punch (across any source, matched by Employee ID) are marked **Present**
- Employees without punches on working days are marked **Absent**
- Sundays are treated as **Weekend** and are never counted as Absent

## Technologies Used

- HTML5
- CSS3
- JavaScript (ES6)
- Node.js (local PC server)
- Express.js

## Project Structure

```
├── index.html          # Dashboard
├── employee.html       # Employee Lookup
├── dayview.html         # View by Date
├── reports.html         # Reports
├── upload.html          # Import Centre
├── att-data.js          # Shared attendance data logic (single source of truth)
├── server-config.js     # PC server connection settings
├── server.js            # PC server (replaces Firebase -- stores data as local JSON files)
├── package.json          # Server dependencies (Express)
├── images/
├── data/                 # Auto-created by server.js -- stores attendance + Employee Master as JSON
└── README.md
```

## Running the Server

1. Install Node.js if not already installed: https://nodejs.org
2. Open a terminal in the project folder and run:
   ```
   npm install
   node server.js
   ```
3. Open `http://localhost:5000` in a browser.

Data is stored locally in the `data/` folder as plain JSON files -- no cloud account or database setup required. To make the dashboard reachable by other computers on the same network, update `SERVER_BASE_URL` in `server-config.js` to the host PC's network IP address instead of `localhost`.

## Data Sources

The system supports importing data from:
- Face Recognition devices
- Fingerprint biometric devices
- Great HR attendance exports
- Employee Master records

## Future Improvements

- Holiday calendar support
- Leave management
- Live biometric synchronization
- Email reports
- Attendance notifications
- Mobile responsive enhancements
- Role-based authentication
- Remote/off-network access to the PC server

## Author
Sherona Appalo