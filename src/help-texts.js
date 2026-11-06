// Uitleg achter elk (?)-knopje. Eenvoudige B1-taal: korte zinnen, één idee per zin.
// HTML is toegestaan (vaste tekst, nooit gebruikersinvoer).
export const HELP = {
  // --- Inloggen / account ---
  'auth-email':
    'Vul het e-mailadres in dat je zelf gebruikt. Ben je uitgenodigd door iemand? Gebruik dan <strong>precies het e-mailadres waarop je de uitnodiging kreeg</strong>.',
  'auth-password-login': 'Vul het wachtwoord in dat je koos toen je je account maakte.',
  'auth-password-new':
    'Kies een wachtwoord van minimaal 8 tekens. Tip: maak er een korte zin van, bijvoorbeeld <em>MijnFietsIsBlauw7</em>. Deel je wachtwoord met niemand.',
  'auth-name': 'Vul je voornaam en achternaam in. Dit ziet alleen jij, en de mensen die jij later toevoegt aan je netwerk.',

  // --- Profiel ---
  'onboarding-blank':
    'Je begint met een <strong>leeg</strong> profiel. Er staat niets in. Samen met je begeleider vul je stap voor stap je stoplicht, leerdoelen en signaleringsplan in.',
  'profile-name': 'De naam van de cliënt. Bijvoorbeeld <em>Daan Vermeulen</em>. Deze naam zie je bovenin het scherm.',
  'profile-supervisor': 'Wie is de vaste ambulant begeleider? Bijvoorbeeld <em>Mark</em>. Mag je ook leeg laten.',
  'profile-budget':
    'Hoeveel geld heb je per week om uit te geven (boodschappen, leuke dingen)? Vul alleen het getal in, bijvoorbeeld <em>70</em>. De Keuze-Tafel rekent hiermee.',
  'profile-goal':
    'Waar spaar je voor? Bijvoorbeeld <em>Laptop</em> of <em>Elektrische fiets (€750)</em>. De Keuze-Tafel laat zien of een keuze je dichterbij of verder weg brengt.',
  'account-switch':
    'Begeleid je meerdere cliënten? Dan heeft elke cliënt een eigen profiel. Tik op <strong>Open</strong> om naar een ander profiel te gaan. Met 🗑️ verwijder je een profiel helemaal.',
  'account-edit': 'Hier pas je de naam, begeleider, het weekgeld en het spaardoel van het geopende profiel aan.',
  'account-new':
    'Maak een nieuw profiel voor een (nieuwe) cliënt. Het profiel start <strong>helemaal leeg</strong>: geen opdrachten, geen netwerk en geen voorbeeldteksten. Zo vul je alles vanaf nul samen in.',
  'account-demo':
    'Wil je eerst zien hoe alles werkt? Laad dan het voorbeeldprofiel van <strong>Daan Vermeulen</strong>. Dit is een apart profiel met verzonnen gegevens. In de Netwerk Weergave kun je daar ook zelf namens een netwerklid reageren om het uit te proberen. Je eigen profiel verandert niet.',

  // --- Stoplicht ---
  stoplicht:
    '💡 Tik op de kleur die past bij hoe jij je nu voelt.<br>• <strong>Groen:</strong> het gaat goed en je hebt overzicht.<br>• <strong>Oranje:</strong> je hoofd raakt vol of je voelt spanning.<br>• <strong>Rood:</strong> het is te veel, je hebt direct rust of hulp nodig.<br>Bij <strong>Groen</strong> is één tik genoeg. Bij <strong>Oranje</strong> kies je wat je zelf gaat doen. Bij <strong>Rood</strong> bevestig je alleen. Later mag je terugkijken op wat er gebeurde.',
  reflectie:
    'Dit is wat je de laatste keer hebt ingevuld bij je stoplicht. De mensen die jouw stoplicht mogen zien, zien deze tekst ook.',
  'phase-tabs':
    'Je ziet automatisch de doelen en het plan van je huidige kleur. Wil je een andere fase bekijken of aanpassen? Tik dan op die kleur. Je stoplicht verandert daar <strong>niet</strong> door.',
  leerdoelen:
    '💡 Per kleur heb je eigen doelen. In <strong>Groen</strong> oefen je zelfstandig. In <strong>Oranje</strong> maak je de doelen kleiner (bijvoorbeeld: een brief alleen klaarleggen in plaats van meteen oplossen). In <strong>Rood</strong> gaat het om rust en veiligheid.<br>Vink een doel af als het gelukt is. Met ✏️ pas je een doel aan, met 🗑️ haal je het weg.',
  signaleringsplan:
    '💡 Hier staat hoe anderen aan jou kunnen zien in welke fase je zit, wat jij zelf kunt doen om rustig te blijven, en wat jouw netwerk (zoals familie of begeleiding) wél en niet moet doen. Tik op <strong>✏️ Plan Wijzigen</strong> om dit op maat te maken.',
  'plan-signalen':
    'Hoe zie je eruit en hoe gedraag je je in deze fase? Bijvoorbeeld: <em>ik slaap slecht, ik laat post liggen</em>. De korte signalen eronder kun je aantikken als je je stoplicht verandert.',
  'plan-zelf': 'Dingen die jij zelf kunt doen om weer rustig te worden of groen te blijven. Bijvoorbeeld: <em>30 minuten wandelen</em>.',
  'plan-netwerk':
    'Wat helpt jou van anderen, en wat juist niet? Bijvoorbeeld: <em>bel mij niet onverwacht over geld</em>. Je netwerk ziet dit als jij dat toestaat in Mijn Cirkel.',

  // --- Reflectie-modal ---
  'mood-signalen':
    'Tik op één of meer signalen die nu bij jou passen. Staat jouw signaal er niet bij? Typ het in het vakje en tik op <strong>+ Toevoegen</strong>. Het wordt dan ook bewaard in je plan.',
  'mood-context':
    'Schrijf in een paar woorden wat er speelt. Bijvoorbeeld: <em>Ik heb slecht geslapen en er ligt een brief van de gemeente</em>. Dit lezen de mensen die je stoplicht mogen zien.',
  'mood-actie':
    'Tik op wat jij zelf nu gaat doen om je beter te voelen. De knoppen komen uit je signaleringsplan. Kies <strong>✏️ Iets anders</strong> als je iets anders wilt doen. Dat wordt dan ook een knop voor de volgende keer.',

  // --- Leerdoel-modal ---
  'goal-kleur':
    'Bij welke stoplichtkleur hoort dit doel? Kies <strong>Groen</strong> voor gewone oefendoelen, <strong>Oranje</strong> voor kleinere stapjes en <strong>Rood</strong> voor rust en veiligheid.',
  'goal-categorie': 'Een kort woord waar het doel over gaat. Bijvoorbeeld <em>Koken</em>, <em>Post</em> of <em>Dagritme</em>. Mag je ook leeg laten.',
  'goal-titel': 'Wat ga je precies doen? Maak het klein en duidelijk. Bijvoorbeeld: <em>Elke woensdag de post op de vaste plek leggen</em>.',

  // --- Signaleringsplan-editor ---
  'sig-fase':
    'Kies welke kleur je wilt aanpassen. Je kunt wisselen tussen kleuren; je wijzigingen blijven bewaard tot je op <strong>Wijzigingen Opslaan</strong> tikt.',
  'sig-signalen-tekst': 'Beschrijf in je eigen woorden hoe je erbij zit in deze fase. Hoe merken jij en anderen dat je in deze kleur zit?',
  'sig-chips':
    'Korte signalen (een paar woorden) die je later snel kunt aantikken als je je stoplicht verandert. Bijvoorbeeld <em>Slecht geslapen</em>. Tik op ✏️ om te wijzigen of 🗑️ om te verwijderen.',
  'sig-zelf': 'Eén ding per regel dat jij zelf kunt doen. Bijvoorbeeld <em>Even naar buiten</em>. Tik op ✏️ om te wijzigen of 🗑️ om te verwijderen.',
  'sig-netwerk':
    'Eén tip per regel voor je netwerk: wat moeten zij doen of juist laten? Bijvoorbeeld <em>Stuur een kort berichtje zonder druk</em>.',

  // --- Keuze-Tafel ---
  keuzetafel:
    '💡 <strong>Hoe werkt de Keuze-Tafel?</strong><br>1. Tik op een onderwerp (bijvoorbeeld 🛵 of 🛑) of vul je eigen vraag in.<br>2. Bekijk de plaatjes en balkjes bij <strong>Pad A (Direct doen)</strong> en <strong>Pad B (Slimme stap)</strong>.<br>3. Tik onderaan op het pad dat jij kiest. Je keuze wordt bewaard bij je afspraken.',
  'keuze-onderwerp':
    'Kies waar je over twijfelt. Kies <strong>✏️ Eigen Keuze</strong> als je iets anders wilt vergelijken, bijvoorbeeld iets kopen.',
  'custom-titel': 'Schrijf wat je wilt doen of kopen. Bijvoorbeeld <em>Nieuwe PlayStation kopen</em> of <em>Niet naar mijn afspraak gaan</em>.',
  'custom-kosten':
    'Hoeveel euro kost het ongeveer? Vul alleen het getal in. Kost het niets? Vul dan <em>0</em> in. Tik daarna op <strong>🎨 Teken Gevolgen</strong>.',
  'keuze-paden':
    '<strong>Pad A</strong> is: meteen doen. <strong>Pad B</strong> is: een slimme tussenstap. De sterren laten zien hoe blij je nu bent. De balkjes laten zien hoeveel weekgeld en rust je overhoudt. Hoe voller het balkje, hoe beter. De tijdlijn laat zien wat er daarna gebeurt.',
  gekozen:
    'Hier staan de keuzes die je hebt gemaakt. Mensen die jouw keuzes mogen zien (vinkje ⚖️ in Mijn Cirkel), zien ze ook. Met ✕ haal je een keuze weg.',

  // --- Opdrachten ---
  opdrachten:
    '💡 <strong>Hoe plaats je een opdracht?</strong><br>1. <strong>Wat:</strong> schrijf kort op waarbij je hulp wilt.<br>2. <strong>Hoe lang en wanneer:</strong> kies hoe lang het duurt (15 minuten tot een dagdeel) en welke dag jij fijn vindt.<br>3. <strong>Wie:</strong> kies één persoon óf <em>Opengooien voor hele groep</em>. Zij kunnen de opdracht dan accepteren of een andere dag voorstellen.',
  'task-title': 'Schrijf in één korte zin wat je wilt doen. Bijvoorbeeld: <em>Samen naar de dokter</em> of <em>Hulp bij brieven invullen</em>.',
  'task-desc': 'Leg uit wat de ander kan verwachten. Bijvoorbeeld: <em>De brieven liggen al klaar op tafel, ik zoek iemand die meekijkt</em>. Mag je ook leeg laten.',
  'task-duration':
    'Hoe lang duurt het ongeveer? <strong>Kort</strong> = 15 tot 30 minuten. <strong>Gemiddeld</strong> = 1 uur. <strong>Groot</strong> = 2 tot 3 uur. <strong>Heel dagdeel</strong> = een ochtend of middag.',
  'task-datetime': 'Op welke dag en hoe laat wil je het doen? Bijvoorbeeld <em>Woensdag 09:00</em> of <em>Zaterdagmiddag</em>.',
  'task-target':
    'Kies één persoon die je het wilt vragen, of kies <strong>📣 Opengooien voor hele groep</strong>. Alleen mensen met het vinkje 🤝 in Mijn Cirkel staan in deze lijst.',
  'task-list':
    'Hier zie je al je opdrachten. ⏳ = nog niemand heeft gereageerd. ✅ = iemand helpt. 🔄 = iemand stelt een andere dag of tijd voor; tik dan op <strong>👍 Akkoord</strong> of <strong>✋ Past niet</strong>. Met ✏️ pas je een opdracht aan en met 🗑️ haal je hem weg.',

  // --- Mijn Cirkel ---
  cirkel:
    '💡 Voeg hier mensen toe met hun naam en e-mailadres, zoals je moeder, begeleider, buurman of bewindvoerder. Met de 3 vinkjes bepaal je zelf wat zij zien: je stoplicht, je opdrachten en/of je keuzes. Je kunt de vinkjes altijd weer uitzetten.',
  'invite-mail':
    'Na het opslaan krijg je een persoonlijke uitnodiging met een code. Die stuur je zelf naar de persoon: via je e-mail, WhatsApp of door de code voor te lezen. Pas als zij inloggen met dit e-mailadres én de code gebruiken, kijken ze mee.',
  'invite-name': 'De naam van de persoon, bijvoorbeeld <em>Anja Vermeulen</em>. Zo herken je hen in de lijst.',
  'invite-role': 'Wat is deze persoon van jou? Bijvoorbeeld familie, begeleider of bewindvoerder. Bij een begeleider of bewindvoerder staat het vinkje voor keuzes al aan.',
  'invite-email': 'Het e-mailadres van de persoon. Ze moeten met <strong>dit</strong> e-mailadres inloggen om mee te kunnen kijken.',
  'perm-mood': 'Aan: deze persoon ziet je stoplicht, je toelichting en wat jij van je netwerk nodig hebt.',
  'perm-tasks': 'Aan: deze persoon ziet opdrachten die voor de hele groep of voor hem/haar zijn, en kan helpen of een ander moment voorstellen.',
  'perm-finance': 'Aan: deze persoon ziet de keuzes die je op de Keuze-Tafel hebt bewaard, en je spaardoel.',

  // --- Netwerk Weergave ---
  'net-select':
    'Kies wiens netwerk je wilt bekijken. Onder <strong>Ik ben netwerklid van</strong> staan cliënten die jou hebben uitgenodigd. Onder <strong>Voorbeeld</strong> zie je hoe jouw eigen netwerkleden jouw gegevens zien.',
  'net-code':
    'Heb je een uitnodiging gekregen? Daarin staat een code van 8 tekens, bijvoorbeeld <em>K7P2-9QXM</em>. Vul die hier in. Let op: je moet ingelogd zijn met het e-mailadres waarop je bent uitgenodigd.',
  'net-mood': 'Zo gaat het nu met de cliënt. Daaronder staat wat jij nu het beste kunt doen (of laten).',
  'net-tasks':
    'Opdrachten waar de cliënt hulp bij wil. Tik op <strong>✅ Ik help</strong> als het jou past. Past de dag of tijd niet? Tik op <strong>🔄 Andere dag/tijd</strong> en stel een ander moment voor.',
  'net-counter-time': 'Wanneer kun jij wel? Bijvoorbeeld <em>Donderdag 14:00</em>.',
  'net-counter-note': 'Een korte uitleg voor de cliënt. Bijvoorbeeld <em>Woensdag moet ik werken, donderdag kan ik wel</em>. Mag leeg blijven.',
  'net-choices': 'De keuzes die de cliënt heeft gemaakt op de Keuze-Tafel. Zo weet je welke afspraken er zijn.',
  'net-log': 'Een overzicht van wat er de laatste tijd is gebeurd en wat voor jou bedoeld is.',

  meldingen:
    'Hier zie je wat er is gebeurd: reacties van je netwerk (zoals een ander voorstel voor een opdracht) en meldingen die jij hebt gestuurd. Nieuwe reacties krijgen een rood bolletje bij 🔔.',

  // Super Admin-portaal
  admin:
    'Dit is het beheerdersscherm. Alleen de beheerder ziet dit. Je ziet hier cijfers over het gebruik van EigenKoers, <strong>zonder namen</strong>. Zo kun je laten zien wat de app oplevert, bijvoorbeeld bij een subsidieaanvraag.',
  'admin-period':
    'Kies van welke periode je de cijfers wilt zien. Laat je de datums leeg (of kies <em>Alles</em>), dan zie je alles. Het aantal cliënten, netwerkleden en de stoplicht-verdeling gaan altijd over <strong>vandaag</strong>.',
  'admin-kpi':
    'De vier belangrijkste cijfers. <strong>Informele zorg</strong>: hoeveel tijd het netwerk hielp. <strong>Pad B</strong>: hoe vaak cliënten de slimme stap kozen. <strong>Bespaard</strong>: een schatting van kosten die niet nodig waren. Bij <em>Rekenregels</em> staat hoe dit wordt berekend.',
  'admin-mood':
    'Hoeveel cliënten nu op groen, oranje of rood staan. Demo-profielen tellen niet mee.',
  'admin-stats':
    'Meer details over de gekozen periode: hoe vaak er op de Keuze-Tafel is gekozen, hoe vaak het stoplicht wisselde en hoeveel opdrachten het netwerk oppakte.',
  'admin-log':
    'Elke regel is één gebeurtenis. Er staan geen namen in. De <strong>cliëntcode</strong> is een geheime code: dezelfde cliënt heeft steeds dezelfde code, maar niemand kan zien wie het is. Met het keuzemenu kies je welke soort gebeurtenissen je ziet.',
  'admin-export':
    'Download de cijfers als bestand voor Excel. <strong>Logboek</strong>: alle regels uit de gekozen periode (en het filter). <strong>Samenvatting</strong>: de totalen en de rekenregels. Handig voor ZonMw of de gemeente.',
  'admin-rules':
    'Zo rekent EigenKoers. De bedragen zijn <strong>schattingen</strong> op basis van vaste afspraken, geen echte rekeningen. Zo is het voor iedereen duidelijk hoe een bedrag tot stand komt.',
};
