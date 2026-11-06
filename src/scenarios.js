// Vaste scenario's voor de Keuze-Tafel (uit de referentie) + generator voor "Eigen keuze".

export const VISUAL_SCENARIOS = {
  scooter: {
    title: 'Scooter / E-bike op afbetaling kopen (€55 p/m)',
    padA: {
      badge: '🛵 Pad A: Nu op Krediet',
      joyStars: 5,
      joyLabel: 'Meteen rijden!',
      budgetPct: 30,
      budgetText: 'Nog maar €25 p/w over',
      calmPct: 20,
      calmText: 'Veel geldstress & schuld',
      steps: [
        { icon: '🎉', time: 'Week 1', text: 'Direct rondrijden, voelt eerst geweldig' },
        { icon: '📉', time: 'Elke week', text: 'Weekgeld zakt hard: krap met eten halen' },
        { icon: '⚠️', time: 'Bij schade', text: 'Geen geld voor reparatie + wel blijven betalen' },
        { icon: '🛑', time: '1 Jaar lang', text: 'Vast aan contract & eigen spaardoel vervalt' },
      ],
    },
    padB: {
      badge: '🛡️ Pad B: 10 Weken Sparen',
      joyStars: 3,
      joyLabel: 'Even geduld hebben',
      budgetPct: 100,
      budgetText: 'Volledig weekgeld vrij',
      calmPct: 95,
      calmText: '100% rust in je hoofd',
      steps: [
        { icon: '🚲', time: 'Week 1', text: 'Nog even op je gewone fiets stappen' },
        { icon: '💶', time: 'Elke week', text: 'Gewoon normaal weekgeld voor boodschappen' },
        { icon: '📈', time: 'Spaarpot', text: 'Samen met bewind €75 p/m apart zetten' },
        { icon: '🏆', time: 'Over 10 wkn', text: 'In één keer contant kopen zonder schuld!' },
      ],
    },
  },
  werk_stoppen: {
    title: 'Morgen wegblijven bij werk / dagbesteding',
    padA: {
      badge: '🛑 Pad A: Direct Wegblijven',
      joyStars: 4,
      joyLabel: 'Morgen uitslapen',
      budgetPct: 45,
      budgetText: 'Werkbonus valt weg',
      calmPct: 25,
      calmText: 'Dagritme draait om',
      steps: [
        { icon: '😴', time: 'Dag 1', text: 'Opluchting: uitslapen en thuis blijven' },
        { icon: '🌙', time: 'Week 2', text: 'Laat naar bed, verveling en piekeren' },
        { icon: '📞', time: 'Instanties', text: 'Lastige telefoontjes van gemeente/werk' },
        { icon: '📉', time: 'Inkomen', text: 'Minder geld per maand te besteden' },
      ],
    },
    padB: {
      badge: '🤝 Pad B: Gesprek met Begeleider',
      joyStars: 3,
      joyLabel: 'Even doorzetten',
      budgetPct: 100,
      budgetText: 'Inkomen blijft veilig',
      calmPct: 85,
      calmText: 'Probleem wordt opgelost',
      steps: [
        { icon: '💪', time: 'Morgen', text: 'Wel gaan, maar op tijd een korte pauze nemen' },
        { icon: '🗣️', time: 'Vrijdag', text: 'Begeleider gaat mee om taken aan te passen' },
        { icon: '💶', time: 'Inkomen', text: 'Je behoudt je volledige weekgeld en bonus' },
        { icon: '🌟', time: 'Resultaat', text: 'Fijnere werkplek zonder verlies van structuur' },
      ],
    },
  },
  geld_uitlenen: {
    title: '€50 van mijn weekgeld uitlenen aan een vriend',
    padA: {
      badge: '💸 Pad A: Nu €50 Meegeven',
      joyStars: 4,
      joyLabel: 'Aardig gevonden worden',
      budgetPct: 25,
      budgetText: 'Bijna blut tot volgende week',
      calmPct: 20,
      calmText: 'Stress of je het terugkrijgt',
      steps: [
        { icon: '🤝', time: 'Vandaag', text: "De ander is blij en jij zegt geen 'nee'" },
        { icon: '🍞', time: 'Zaterdag', text: 'Zelf te weinig geld voor lekkere boodschappen' },
        { icon: '📱', time: 'Volgende wk', text: 'Achter je eigen geld aan moeten appen' },
        { icon: '🟠', time: 'Stoplicht', text: 'Spanning loopt op naar Oranje of Rood' },
      ],
    },
    padB: {
      badge: '🛡️ Pad B: Grens Stellen met App',
      joyStars: 3,
      joyLabel: 'Even duidelijk zijn',
      budgetPct: 100,
      budgetText: 'Je eigen weekgeld veilig',
      calmPct: 95,
      calmText: 'Geen gedoe achteraf',
      steps: [
        { icon: '📱', time: 'Vandaag', text: "Zeggen: 'Mag niet volgens mijn budgetplan'" },
        { icon: '🛒', time: 'Zaterdag', text: 'Genoeg geld voor je eigen eten en weekend' },
        { icon: '😌', time: 'Volgende wk', text: 'Geen ruzie over terugbetalen' },
        { icon: '🟢', time: 'Stoplicht', text: 'Je blijft rustig in fase Groen' },
      ],
    },
  },
};

function euro(n) {
  const v = Math.round(Number(n) * 100) / 100;
  return '€' + (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));
}

/**
 * Bouwt de vergelijking voor een eigen keuze op basis van titel, kosten,
 * weekgeld (mag null zijn) en spaardoel (mag leeg zijn).
 */
export function buildCustomScenario({ title, cost, budget, goal }) {
  const safeTitle = (title || '').trim() || 'Eigen impulsieve keuze';
  const c = Math.max(0, Number(cost) || 0);
  const hasBudget = budget !== null && budget !== undefined && Number(budget) > 0;
  const b = hasBudget ? Number(budget) : null;
  const goalText = (goal || '').trim() || 'je spaardoel';

  let budgetPctA = 60;
  let budgetTextA = `Kost ${euro(c)} van je weekgeld`;
  let walletText = `Kost ${euro(c)}. Vul je weekgeld in bij 👤 Account voor een precieze som`;
  if (hasBudget) {
    const left = Math.max(0, b - c);
    budgetPctA = Math.max(5, Math.min(100, Math.round((left / b) * 100)));
    budgetTextA = `Nog ${euro(left)} van ${euro(b)} over`;
    walletText = c > b
      ? `Kost ${euro(c)}: dat is meer dan je hele weekgeld (${euro(b)})`
      : `Kost ${euro(c)}, er blijft ${euro(left)} over deze week`;
  }
  const calmA = c === 0 ? 55 : Math.max(15, 60 - Math.round(((hasBudget ? c / b : 0.5)) * 50));

  return {
    title: safeTitle,
    padA: {
      badge: '⚡ Pad A: Direct Doen',
      joyStars: 4,
      joyLabel: 'Meteen je zin',
      budgetPct: budgetPctA,
      budgetText: budgetTextA,
      calmPct: calmA,
      calmText: 'Meer kans op onrust',
      steps: [
        { icon: '⚡', time: 'Vandaag', text: `Direct kiezen voor: ${safeTitle}` },
        { icon: '💸', time: 'Portemonnee', text: walletText },
        { icon: '🟠', time: 'Gevoel', text: 'Kans op spijt of krapte aan het einde van de week' },
        { icon: '⏳', time: 'Spaardoel', text: `${goalText.charAt(0).toUpperCase() + goalText.slice(1)} duurt langer` },
      ],
    },
    padB: {
      badge: '🛡️ Pad B: Slimme Tussenstap',
      joyStars: 3,
      joyLabel: '24 uur bedenktijd',
      budgetPct: 100,
      budgetText: hasBudget ? `Volledige ${euro(b)} vrij` : 'Volledig weekgeld vrij',
      calmPct: 90,
      calmText: 'Overzicht & controle',
      steps: [
        { icon: '🧘', time: 'Vandaag', text: 'Eerst één nachtje over slapen en bespreken' },
        { icon: '💶', time: 'Portemonnee', text: hasBudget ? `Je houdt je volledige ${euro(b)} weekgeld over` : 'Je houdt je volledige weekgeld over' },
        { icon: '🟢', time: 'Gevoel', text: 'Rust in je hoofd en geen onverwachte tekorten' },
        { icon: '🎯', time: 'Spaardoel', text: `Je komt dichter bij: ${goalText}` },
      ],
    },
  };
}
