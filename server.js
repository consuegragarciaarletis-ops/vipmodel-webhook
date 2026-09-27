const express = require('express');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Clave de servicio de Firebase (Service Account)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Webhook para recibir notificaciones de pago desde BTCPay Server
app.post('/btcpay-webhook', async (req, res) => {
  try {
    const event = req.body;

    if (event && event.type === 'InvoiceSettled') {
      const invoiceId = event.invoiceId;

      const invoiceRef = db.collection('invoices').doc(invoiceId);
      const invoiceDoc = await invoiceRef.get();

      if (!invoiceDoc.exists) {
        console.error('Factura no encontrada:', invoiceId);
        return res.status(404).send('Factura no encontrada');
      }

      const invoiceData = invoiceDoc.data();

      if (invoiceData.status === 'settled') {
        return res.status(200).send('Factura procesada anteriormente');
      }

      const userId = invoiceData.userId;
      const gemsToCredit = Number(invoiceData.gemsToCredit) || 0;

      // Transacción en Firebase: Suma Gemas y actualiza factura
      await db.runTransaction(async (transaction) => {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await transaction.get(userRef);

        if (!userDoc.exists) {
          throw new Error('El usuario no existe');
        }

        const currentBalance = Number(userDoc.data().gemsBalance) || 0;
        const newBalance = currentBalance + gemsToCredit;

        transaction.update(userRef, { gemsBalance: newBalance });

        transaction.update(invoiceRef, {
          status: 'settled',
          settled_at: admin.firestore.FieldValue.serverTimestamp()
        });

        const transRef = db.collection('transactions').doc();
        transaction.set(transRef, {
          userId: userId,
          type: 'deposit_btcpay',
          amountUSD: invoiceData.amountUSD,
          gemsCredited: gemsToCredit,
          invoiceId: invoiceId,
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      console.log(`Éxito: Se sumaron ${gemsToCredit} Gemas al usuario ${userId}`);
      return res.status(200).send('Gemas acreditadas con éxito');
    }

    return res.status(200).send('Evento recibido');
  } catch (error) {
    console.error('Error en Webhook:', error);
    return res.status(500).send('Error interno del servidor');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de Webhooks activo en el puerto ${PORT}`);
});
      
