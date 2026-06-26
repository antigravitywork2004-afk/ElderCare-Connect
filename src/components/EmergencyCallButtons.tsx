import React from "react";
import { Phone, MessageSquare } from "lucide-react";

type Contact = {
  id: string;
  name: string;
  phone: string | null;
  relation?: string | null;
};

type Caregiver = {
  id: string;
  name: string | null;
  phone: string | null;
};

interface EmergencyCallButtonsProps {
  caregivers: Caregiver[];
  emergencyContacts: Contact[];
  profileEmergency?: { name: string | null; phone: string | null } | null;
}

/**
 * Remove all characters except digits and the plus sign.
 */
function cleanPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/[^\d+]/g, "");
}

function isValidPhone(phone: string | null | undefined): boolean {
  const cleaned = cleanPhone(phone);
  return cleaned.length > 0;
}

function handleCall(phone: string | null | undefined) {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return;
  const telUrl = `tel:${cleaned}`;
  try {
    // Prefer navigation via location.href when possible
    window.location.href = telUrl;
  } catch (_) {
    window.open(telUrl, "_self");
  }
}

function handleSMS(phone: string | null | undefined) {
  const cleaned = cleanPhone(phone);
  if (!cleaned) return;
  const smsUrl = `sms:${cleaned}?body=Emergency! I need help.`;
  try {
    window.location.href = smsUrl;
  } catch (_) {
    window.open(smsUrl, "_self");
  }
}

export const EmergencyCallButtons: React.FC<EmergencyCallButtonsProps> = ({
  caregivers,
  emergencyContacts,
  profileEmergency,
}) => {
  // Combine contacts in required order: profileEmergency, caregivers, emergencyContacts
  const combinedContacts = React.useMemo(() => {
    const list: { id: string; name: string; phone: string | null; relationship?: string | null }[] = [];
    if (profileEmergency?.phone) {
      list.push({ id: "profile-emergency", name: profileEmergency.name ?? "Emergency", phone: profileEmergency.phone });
    }
    caregivers.forEach((c) => {
      list.push({ id: c.id, name: c.name ?? "Caregiver", phone: c.phone });
    });
    emergencyContacts.forEach((c) => {
      list.push({ id: c.id, name: c.name, phone: c.phone, relationship: c.relation });
    });
    return list;
  }, [caregivers, emergencyContacts, profileEmergency]);

  // First valid contact for SOS (calls highest‑priority contact)
  const sosContact = combinedContacts.find((c) => isValidPhone(c.phone)) || null;

  // If no contacts have a usable phone number, render fallback UI
  const contactsWithPhone = combinedContacts.filter((c) => isValidPhone(c.phone));
  if (contactsWithPhone.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">No emergency contacts available.</div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* SOS button */}
      {sosContact && (
        <button
          type="button"
          onClick={() => handleCall(sosContact.phone)}
          className="inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white px-3 py-2 text-sm font-medium hover:bg-red-700 transition-colors"
          title="SOS – Call highest‑priority emergency contact"
        >
          <Phone className="size-4" />
          SOS Call
        </button>
      )}

      {/* Render each contact */}
      {combinedContacts.map((c) => {
        if (!isValidPhone(c.phone)) return null;
        return (
          <div key={c.id} className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="font-medium">{c.name}</span>
              {c.relationship && (
                <span className="text-sm text-muted-foreground">{c.relationship}</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSMS(c.phone)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                title={`SMS ${c.name}`}
              >
                <MessageSquare className="size-4" />
                SMS
              </button>
              <button
                type="button"
                onClick={() => handleCall(c.phone)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
                title={`Call ${c.name}`}
              >
                <Phone className="size-4" />
                Call
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default EmergencyCallButtons;
