import express from 'express';
import type { Request, Response } from 'express'; 
import cors from 'cors';
import mysql from 'mysql2/promise'; 
import 'dotenv/config'; 

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 5000;

app.use(cors());
app.use(express.json());

// MySQL Database Connection Pool
const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '', 
    database: process.env.DB_NAME || 'employee_inv', 
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ==================================================================
// 📦 INVENTORY APIs (MySQL Backed)
// ==================================================================

// Fetch all inventory items
app.get('/api/inventory', async (_req: Request, res: Response) => {
    try {
        const [rows] = await db.query('SELECT * FROM inventory');
        res.json(rows);
    } catch (err) {
        console.error("Database read error:", err);
        res.status(500).json({ error: 'Failed to read inventory data from database.' });
    }
});

// Add a new inventory item
app.post('/api/inventory', async (req: Request, res: Response) => {
    const { itemId, productName, location, stockLevel, status } = req.body;
    try {
        await db.execute(
            'INSERT INTO inventory (itemId, productName, location, stockLevel, status) VALUES (?, ?, ?, ?, ?)',
            [itemId, productName, location, stockLevel, status]
        );
        
        const [rows] = await db.query('SELECT * FROM inventory');
        res.json({ message: 'Success', data: rows });
    } catch (err) {
        console.error("Database write error:", err);
        res.status(500).json({ error: 'Failed to write inventory data.' });
    }
});

// Update an existing inventory item
app.put('/api/inventory/:itemId', async (req: Request, res: Response) => {
    const itemId = req.params.itemId;
    const { productName, location, stockLevel, status } = req.body;
    try {
        const [result]: any = await db.execute(
            'UPDATE inventory SET productName = ?, location = ?, stockLevel = ?, status = ? WHERE itemId = ?',
            [productName, location, stockLevel, status, itemId]
        );

        if (result.affectedRows > 0) {
            const [rows] = await db.query('SELECT * FROM inventory');
            res.json({ message: 'Updated', data: rows });
        } else {
            res.status(404).json({ error: 'Item not found' });
        }
    } catch (err) {
        console.error("Database update error:", err);
        res.status(500).json({ error: 'Failed to update inventory item.' });
    }
});

// Delete an inventory item
app.delete('/api/inventory/:itemId', async (req: Request, res: Response) => {
    const itemId = req.params.itemId;
    try {
        await db.execute('DELETE FROM inventory WHERE itemId = ?', [itemId]);
        const [rows] = await db.query('SELECT * FROM inventory');
        res.json({ message: 'Deleted', data: rows });
    } catch (err) {
        console.error("Database delete error:", err);
        res.status(500).json({ error: 'Failed to delete inventory item.' });
    }
});

// ==================================================================
// 👥 EMPLOYEE APIs
// ==================================================================
app.get('/api/employees', async (_req: Request, res: Response) => {
    try {
        const [rows] = await db.query('SELECT * FROM employee_inv'); 
        res.json(rows);
    } catch (err) {
        console.error("Database employee read error:", err);
        res.status(500).json({ error: 'Failed to read employee data.' });
    }
});

// ==================================================================
// 📋 REQUEST MANAGEMENT APIs (Parent-Child Relational Tables)
// ==================================================================

// Create a new request along with its relational request items
app.post('/api/requests', async (req: Request, res: Response) => {
    const { employeeName, reason, products } = req.body; 
    // Expects 'products' as an array of items, e.g., ["Monitor", "Wireless Mouse"] or objects
    
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Insert into parent requests table
        const [reqResult]: any = await connection.execute(
            'INSERT INTO requests (employee_name, reason, status) VALUES (?, ?, ?)',
            [employeeName, reason, 'Pending']
        );
        const requestId = reqResult.insertId;

        // 2. Insert each requested product item into child request_items table
        if (Array.isArray(products)) {
            for (const prod of products) {
                const productName = typeof prod === 'string' ? prod : prod.productName || prod.name;
                const quantity = prod.quantity || 1;
                
                await connection.execute(
                    'INSERT INTO request_items (request_id, product_name, quantity) VALUES (?, ?, ?)',
                    [requestId, productName, quantity]
                );
            }
        }

        await connection.commit();
        res.json({ message: 'Request created successfully', requestId });
    } catch (err) {
        await connection.rollback();
        console.error("Request transaction error:", err);
        res.status(500).json({ error: 'Failed to save employee allocation request.' });
    } finally {
        connection.release();
    }
});

// Get all compiled requests combined with child row strings for dashboard interface
app.get('/api/requests', async (_req: Request, res: Response) => {
    try {
        const queryStr = `
            SELECT r.request_id, r.employee_name, r.reason, r.status, r.staff_comment, r.created_at,
                   ri.product_name, ri.quantity
            FROM requests r
            LEFT JOIN request_items ri ON r.request_id = ri.request_id
            ORDER BY r.created_at DESC
        `;
        const [rows]: any = await db.query(queryStr);

        // Group rows together by unique request_id
        const requestsMap: Record<number, any> = {};
        for (const row of rows) {
            if (!requestsMap[row.request_id]) {
                requestsMap[row.request_id] = {
                    id: row.request_id,
                    employeeName: row.employee_name,
                    reason: row.reason,
                    status: row.status,
                    rejectionReason: row.staff_comment,
                    date: row.created_at,
                    products: []
                };
            }
            if (row.product_name) {
                requestsMap[row.request_id].products.push(row.product_name);
            }
        }

        res.json(Object.values(requestsMap));
    } catch (err) {
        console.error("Fetch requests array error:", err);
        res.status(500).json({ error: 'Failed to read requests data roster.' });
    }
});

// Process a request transaction: Approved or Rejected
app.post('/api/requests/process', async (req: Request, res: Response) => {
    const { requestId, status, staffComment } = req.body; // status values expected: 'Approved' or 'Rejected'
    
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Alter state directly inside main requests parent row
        await connection.execute(
            'UPDATE requests SET status = ?, staff_comment = ? WHERE request_id = ?',
            [status, staffComment || null, requestId]
        );

        // 2. If action represents an approval, build and commit rows into assignment structures
        if (status === 'Approved') {
            const [reqDetails]: any = await connection.execute('SELECT * FROM requests WHERE request_id = ?', [requestId]);
            const [reqItems]: any = await connection.execute('SELECT * FROM request_items WHERE request_id = ?', [requestId]);
            
            if (reqDetails.length > 0) {
                const empName = reqDetails[0].employee_name;
                
                // Track dynamic mapping back to employee record primary keys
                const [empLookup]: any = await connection.execute('SELECT employeeID FROM employee_inv WHERE employeeName = ? LIMIT 1', [empName]);
                const empId = empLookup.length > 0 ? empLookup[0].employeeID : 'EMP-UNKNOWN';

                // Insert into root parent assignments table
                const [assignResult]: any = await connection.execute(
                    'INSERT INTO assignments (employee_id, employee_name, assignment_date, status) VALUES (?, ?, NOW(), ?)',
                    [empId, empName, 'Completed']
                );
                const assignmentId = assignResult.insertId;

                // Loop through and copy all nested matching sub-elements down into assignment child entries
                for (const item of reqItems) {
                    await connection.execute(
                        'INSERT INTO assignment_items (assignment_id, product_name, quantity) VALUES (?, ?, ?)',
                        [assignmentId, item.product_name, item.quantity]
                    );

                    // Drop inventory stock values dynamically based on items allocated
                    await connection.execute(
                        'UPDATE inventory SET stockLevel = GREATEST(stockLevel - ?, 0) WHERE productName = ?',
                        [item.quantity, item.product_name]
                    );
                }
            }
        }

        await connection.commit();
        res.json({ message: `Request successfully processed as ${status}` });
    } catch (err) {
        await connection.rollback();
        console.error("Process request transaction state error:", err);
        res.status(500).json({ error: 'Failed to apply state transitions to request item.' });
    } finally {
        connection.release();
    }
});

app.listen(PORT, () => {
    console.log(`Backend Server running on http://localhost:${PORT}`);
});