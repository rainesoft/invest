'use client';

import { useState, useEffect } from 'react';
import { usePaystackPayment } from 'react-paystack';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2 } from 'lucide-react';

interface CheckoutButtonProps {
  email: string;
  userId: string;
  amountUSD: number; // The base software fee in USD
}

export default function CheckoutButton({
  email,
  userId,
  amountUSD,
}: CheckoutButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);

  // Fetch the live USD -> GHS exchange rate on mount
  useEffect(() => {
    async function fetchRate() {
      try {
        const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await res.json();
        if (data && data.rates && data.rates.GHS) {
          setExchangeRate(data.rates.GHS);
        } else {
          setExchangeRate(15.0); // Fallback rate if API fails
        }
      } catch (err) {
        console.error("Failed to fetch exchange rate", err);
        setExchangeRate(15.0); // Fallback rate
      }
    }
    fetchRate();
  }, []);

  // Calculate dynamic amount in pesewas (lowest denomination)
  const dynamicAmountPesewas = exchangeRate ? Math.round(amountUSD * exchangeRate * 100) : 0;

  const config = {
    reference: new Date().getTime().toString(),
    email,
    amount: dynamicAmountPesewas, 
    currency: 'GHS',
    publicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
    channels: ['card', 'bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer'],
    metadata: {
      custom_fields: [
        {
          display_name: 'User ID',
          variable_name: 'user_id',
          value: userId,
        },
        {
          display_name: 'Billing Amount USD',
          variable_name: 'billing_amount_usd',
          value: amountUSD,
        }
      ],
    },
  };

  const handleCheckout = () => {
    if (!exchangeRate) return; // Prevent checkout until rate loads
    setLoading(true);
    console.log("PAYSTACK CONFIG DEBUG:", config);
    if (!config.publicKey) {
      alert("Missing Paystack Public Key! Did you restart the server?");
      setLoading(false);
      return;
    }
    initializePayment({ onSuccess, onClose } as any);
  };

  const initializePayment = usePaystackPayment(config);

  const onSuccess = (reference: any) => {
    setLoading(true);
    // We refresh the router to aggressively invalidate cache and re-fetch the subscription tier
    setTimeout(() => {
      router.refresh();
      setLoading(false);
    }, 2000); // Wait a moment for webhook to process
  };

  const onClose = () => {
    setLoading(false);
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      style={{
        width: '100%',
        padding: '0.875rem',
        backgroundColor: '#10b981',
        color: '#000',
        border: 'none',
        borderRadius: '8px',
        fontSize: '1rem',
        fontWeight: 600,
        cursor: loading ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        transition: 'background-color 0.2s',
        opacity: loading ? 0.7 : 1,
      }}
      onMouseOver={(e) => {
        if (!loading) e.currentTarget.style.backgroundColor = '#0ea5e9';
      }}
      onMouseOut={(e) => {
        if (!loading) e.currentTarget.style.backgroundColor = '#10b981';
      }}
    >
      {loading ? (
        <>
          <Loader2 className="animate-spin" size={20} />
          Processing Upgrade...
        </>
      ) : (
        <>
          <CreditCard size={18} />
          Upgrade to Alpha
        </>
      )}
    </button>
  );
}
