/* ==========================================================
   Mock catalog — Philippine hardware store
   ~40 items, used for the test UI. Edit catalog.csv for later.
   ========================================================== */

const SEED_FOLDERS = [
  { id: 'all',       name: 'All Items',  builtin: true },
  { id: 'plumbing',  name: 'Plumbing',   builtin: false },
  { id: 'electrical',name: 'Electrical', builtin: false },
  { id: 'fasteners', name: 'Fasteners',  builtin: false },
  { id: 'tools',     name: 'Tools',      builtin: false },
  { id: 'paint',     name: 'Paint',      builtin: false },
  { id: 'cement',    name: 'Cement',     builtin: false },
  { id: 'safety',    name: 'Safety',     builtin: false },
  { id: 'adhesive',  name: 'Adhesive',   builtin: false },
];

const PRODUCTS = [
  // ---- Plumbing ----
  { id: 'p001', sku: 'PVC-ELB-12', barcode: '4801234500011', name: 'PVC Elbow 1/2"', brand: 'Atlanta', folder: 'plumbing', unit: 'pc',
    price: 12.00, cost: 7.50, stock: 240, reorderPoint: 50,
    aliases: ['kodo', 'elbow half', 'kodo half', '1/2 elbow', 'pvc kodo'] },
  { id: 'p002', sku: 'PVC-ELB-34', barcode: '4801234500028', name: 'PVC Elbow 3/4"', brand: 'Atlanta', folder: 'plumbing', unit: 'pc',
    price: 16.00, cost: 10.00, stock: 180, reorderPoint: 40,
    aliases: ['kodo 3/4', 'elbow three fourths'] },
  { id: 'p003', sku: 'PVC-TEE-12', barcode: '4801234500035', name: 'PVC Tee 1/2"', brand: 'Atlanta', folder: 'plumbing', unit: 'pc',
    price: 14.50, cost: 9.00, stock: 200, reorderPoint: 50,
    aliases: ['tee half', 'pvc tee'] },
  { id: 'p004', sku: 'PVC-PIPE-12-3M', barcode: '4801234500042', name: 'PVC Pipe 1/2" × 3m', brand: 'Atlanta', folder: 'plumbing', unit: 'pc',
    price: 145.00, cost: 105.00, stock: 60, reorderPoint: 20,
    aliases: ['pipe half', 'tubo', 'pvc tubo'] },
  { id: 'p005', sku: 'FAUCET-BR-12', barcode: '4801234500059', name: 'Brass Faucet 1/2"', brand: 'Omega', folder: 'plumbing', unit: 'pc',
    price: 185.00, cost: 130.00, stock: 22, reorderPoint: 10,
    aliases: ['gripo', 'faucet', 'tap'] },
  { id: 'p006', sku: 'TEFLON-12', barcode: '4801234500066', name: 'Teflon Tape 1/2"', brand: 'Henkel', folder: 'plumbing', unit: 'roll',
    price: 25.00, cost: 15.00, stock: 320, reorderPoint: 80,
    aliases: ['teflon', 'tape teflon'] },

  // ---- Electrical ----
  { id: 'e001', sku: 'WIRE-THHN-12', barcode: '4801234600015', name: 'THHN Wire #12 (per meter)', brand: 'Phelps Dodge', folder: 'electrical', unit: 'm',
    price: 28.00, cost: 19.00, stock: 850, reorderPoint: 200,
    aliases: ['kawad', 'wire 12', 'thhn 12'] },
  { id: 'e002', sku: 'WIRE-THHN-14', barcode: '4801234600022', name: 'THHN Wire #14 (per meter)', brand: 'Phelps Dodge', folder: 'electrical', unit: 'm',
    price: 22.00, cost: 15.00, stock: 12, reorderPoint: 200,
    aliases: ['wire 14', 'kawad 14'] },
  { id: 'e003', sku: 'BULB-LED-9W', barcode: '4801234600039', name: 'LED Bulb 9W Daylight', brand: 'Firefly', folder: 'electrical', unit: 'pc',
    price: 89.00, cost: 56.00, stock: 78, reorderPoint: 30,
    aliases: ['bulb led', 'led 9 watts', 'firefly led'] },
  { id: 'e004', sku: 'OUTLET-2G', barcode: '4801234600046', name: 'Duplex Outlet 2-Gang', brand: 'Royu', folder: 'electrical', unit: 'pc',
    price: 65.00, cost: 42.00, stock: 44, reorderPoint: 20,
    aliases: ['outlet', 'saksakan', 'duplex'] },
  { id: 'e005', sku: 'SWITCH-1G', barcode: '4801234600053', name: 'Switch 1-Gang', brand: 'Royu', folder: 'electrical', unit: 'pc',
    price: 48.00, cost: 30.00, stock: 56, reorderPoint: 20,
    aliases: ['switch', 'one gang'] },
  { id: 'e006', sku: 'TAPE-EL-BLK', barcode: '4801234600060', name: 'Electrical Tape Black', brand: '3M', folder: 'electrical', unit: 'roll',
    price: 32.00, cost: 19.00, stock: 200, reorderPoint: 60,
    aliases: ['electrical tape', 'tape black'] },
  { id: 'e007', sku: 'BREAKER-30A', barcode: '4801234600077', name: 'Circuit Breaker 30A', brand: 'Royu', folder: 'electrical', unit: 'pc',
    price: 320.00, cost: 240.00, stock: 8, reorderPoint: 10,
    aliases: ['breaker 30', 'circuit breaker'] },

  // ---- Fasteners ----
  { id: 'f001', sku: 'NAIL-CW-2', barcode: '4801234700019', name: 'Common Wire Nail 2"', brand: 'Generic', folder: 'fasteners', unit: 'kg',
    price: 95.00, cost: 65.00, stock: 38, reorderPoint: 15,
    aliases: ['pako', 'nail 2 inch', 'cw nail 2'] },
  { id: 'f002', sku: 'NAIL-CW-3', barcode: '4801234700026', name: 'Common Wire Nail 3"', brand: 'Generic', folder: 'fasteners', unit: 'kg',
    price: 90.00, cost: 62.00, stock: 24, reorderPoint: 15,
    aliases: ['pako 3', 'nail 3 inch'] },
  { id: 'f003', sku: 'SCREW-WD-1', barcode: '4801234700033', name: 'Wood Screw #8 × 1"', brand: 'Generic', folder: 'fasteners', unit: 'pc',
    price: 1.50, cost: 0.80, stock: 1200, reorderPoint: 300,
    aliases: ['turnilyo', 'wood screw', 'screw 1'] },
  { id: 'f004', sku: 'BOLT-M10-100', barcode: '4801234700040', name: 'Hex Bolt M10 × 100mm', brand: 'Generic', folder: 'fasteners', unit: 'pc',
    price: 18.00, cost: 11.00, stock: 320, reorderPoint: 80,
    aliases: ['bolt m10', 'hex bolt'] },
  { id: 'f005', sku: 'WASHER-M10', barcode: '4801234700057', name: 'Flat Washer M10', brand: 'Generic', folder: 'fasteners', unit: 'pc',
    price: 2.00, cost: 1.00, stock: 800, reorderPoint: 200,
    aliases: ['washer 10', 'flat washer'] },

  // ---- Tools ----
  { id: 't001', sku: 'HMR-CLAW-16', barcode: '4801234800013', name: 'Claw Hammer 16oz', brand: 'Stanley', folder: 'tools', unit: 'pc',
    price: 285.00, cost: 195.00, stock: 14, reorderPoint: 5,
    aliases: ['martilyo', 'hammer', 'claw hammer'] },
  { id: 't002', sku: 'SCRDRV-PH2', barcode: '4801234800020', name: 'Phillips Screwdriver #2', brand: 'Stanley', folder: 'tools', unit: 'pc',
    price: 145.00, cost: 95.00, stock: 21, reorderPoint: 8,
    aliases: ['screwdriver', 'phillips', 'destornilyador'] },
  { id: 't003', sku: 'PLIER-CB-8', barcode: '4801234800037', name: 'Combination Pliers 8"', brand: 'Tolsen', folder: 'tools', unit: 'pc',
    price: 220.00, cost: 150.00, stock: 12, reorderPoint: 6,
    aliases: ['plyer', 'plyers', 'pliers'] },
  { id: 't004', sku: 'TAPE-MEAS-5M', barcode: '4801234800044', name: 'Tape Measure 5m', brand: 'Stanley', folder: 'tools', unit: 'pc',
    price: 195.00, cost: 130.00, stock: 18, reorderPoint: 8,
    aliases: ['tape measure', 'meter', 'metro'] },
  { id: 't005', sku: 'SAW-HACK-12', barcode: '4801234800051', name: 'Hacksaw Frame 12"', brand: 'Tolsen', folder: 'tools', unit: 'pc',
    price: 245.00, cost: 168.00, stock: 9, reorderPoint: 4,
    aliases: ['lagari', 'hacksaw'] },
  { id: 't006', sku: 'LVL-ALUM-24', barcode: '4801234800068', name: 'Aluminum Level 24"', brand: 'Tolsen', folder: 'tools', unit: 'pc',
    price: 385.00, cost: 270.00, stock: 6, reorderPoint: 3,
    aliases: ['level', 'antay-antayan'] },

  // ---- Paint ----
  { id: 'pt001', sku: 'PAINT-LATEX-1L-WHT', barcode: '4801234900017', name: 'Latex Paint White 1L', brand: 'Boysen', folder: 'paint', unit: 'L',
    price: 285.00, cost: 198.00, stock: 28, reorderPoint: 10,
    aliases: ['pintura', 'latex puti', 'paint white'] },
  { id: 'pt002', sku: 'PAINT-ENAMEL-1L-BLK', barcode: '4801234900024', name: 'Quick-Dry Enamel Black 1L', brand: 'Davies', folder: 'paint', unit: 'L',
    price: 320.00, cost: 220.00, stock: 16, reorderPoint: 8,
    aliases: ['enamel itim', 'pintura itim'] },
  { id: 'pt003', sku: 'BRUSH-PT-3', barcode: '4801234900031', name: 'Paint Brush 3"', brand: 'Generic', folder: 'paint', unit: 'pc',
    price: 75.00, cost: 45.00, stock: 42, reorderPoint: 15,
    aliases: ['brocha', 'brush', 'paint brush'] },
  { id: 'pt004', sku: 'ROLLER-9', barcode: '4801234900048', name: 'Paint Roller 9"', brand: 'Generic', folder: 'paint', unit: 'pc',
    price: 145.00, cost: 92.00, stock: 18, reorderPoint: 8,
    aliases: ['roller', 'paint roller'] },
  { id: 'pt005', sku: 'THINNER-1L', barcode: '4801234900055', name: 'Paint Thinner 1L', brand: 'Boysen', folder: 'paint', unit: 'L',
    price: 120.00, cost: 80.00, stock: 30, reorderPoint: 12,
    aliases: ['thinner', 'tiner'] },

  // ---- Cement ----
  { id: 'c001', sku: 'CEM-PORT-40', barcode: '4801235000013', name: 'Portland Cement 40kg', brand: 'Holcim', folder: 'cement', unit: 'bag',
    price: 285.00, cost: 235.00, stock: 110, reorderPoint: 30,
    aliases: ['cement', 'semento', 'holcim'] },
  { id: 'c002', sku: 'SAND-FINE-CUM', barcode: '4801235000020', name: 'Fine Sand (per cu.m)', brand: 'Local', folder: 'cement', unit: 'cu.m',
    price: 1450.00, cost: 1100.00, stock: 4, reorderPoint: 2,
    aliases: ['buhangin', 'sand'] },
  { id: 'c003', sku: 'GRAVEL-3-CUM', barcode: '4801235000037', name: 'Gravel 3/4" (per cu.m)', brand: 'Local', folder: 'cement', unit: 'cu.m',
    price: 1380.00, cost: 1050.00, stock: 3, reorderPoint: 2,
    aliases: ['graba', 'gravel'] },
  { id: 'c004', sku: 'CHB-4', barcode: '4801235000044', name: 'Hollow Block 4"', brand: 'Local', folder: 'cement', unit: 'pc',
    price: 12.50, cost: 9.00, stock: 480, reorderPoint: 100,
    aliases: ['hollow block', 'chb', 'block 4'] },

  // ---- Safety ----
  { id: 's001', sku: 'GLOVES-WORK', barcode: '4801235100010', name: 'Cotton Work Gloves', brand: 'Generic', folder: 'safety', unit: 'pair',
    price: 38.00, cost: 22.00, stock: 90, reorderPoint: 30,
    aliases: ['gloves', 'guantes'] },
  { id: 's002', sku: 'GOGGLES-SAFE', barcode: '4801235100027', name: 'Safety Goggles Clear', brand: '3M', folder: 'safety', unit: 'pc',
    price: 145.00, cost: 95.00, stock: 14, reorderPoint: 8,
    aliases: ['goggles', 'safety glasses'] },
  { id: 's003', sku: 'MASK-N95', barcode: '4801235100034', name: 'N95 Dust Mask', brand: '3M', folder: 'safety', unit: 'pc',
    price: 55.00, cost: 32.00, stock: 0, reorderPoint: 20,
    aliases: ['mask', 'n95', 'dust mask'] },
  { id: 's004', sku: 'HARDHAT-YEL', barcode: '4801235100041', name: 'Hard Hat Yellow', brand: 'Generic', folder: 'safety', unit: 'pc',
    price: 240.00, cost: 160.00, stock: 11, reorderPoint: 5,
    aliases: ['hard hat', 'helmet', 'casco'] },

  // ---- Adhesive ----
  { id: 'a001', sku: 'EPOXY-MIGHTY', barcode: '4801235200017', name: 'Mighty Bond Epoxy 50g', brand: 'Pioneer', folder: 'adhesive', unit: 'pc',
    price: 165.00, cost: 110.00, stock: 26, reorderPoint: 12,
    aliases: ['epoxy', 'mighty bond', 'pioneer'] },
  { id: 'a002', sku: 'GLUE-RUGBY', barcode: '4801235200024', name: 'Contact Cement Rugby 250mL', brand: 'Pioneer', folder: 'adhesive', unit: 'pc',
    price: 145.00, cost: 95.00, stock: 18, reorderPoint: 8,
    aliases: ['rugby', 'kola', 'contact cement'] },
  { id: 'a003', sku: 'GLUE-PVC-200', barcode: '4801235200031', name: 'PVC Solvent Cement 200mL', brand: 'Atlanta', folder: 'adhesive', unit: 'pc',
    price: 95.00, cost: 62.00, stock: 22, reorderPoint: 10,
    aliases: ['pvc cement', 'solvent', 'pvc kola'] },
  { id: 'a004', sku: 'SILICONE-WHT', barcode: '4801235200048', name: 'Silicone Sealant White', brand: 'Bostik', folder: 'adhesive', unit: 'pc',
    price: 215.00, cost: 145.00, stock: 13, reorderPoint: 6,
    aliases: ['silicone', 'sealant', 'pampatak'] },
];

const CUSTOMERS = [
  { id: 'c-001', name: 'Mang Ricardo Construction', phone: '0917-823-4501', address: 'San Pedro, Laguna',
    isCreditCustomer: true, creditLimit: 30000, currentBalance: 8450.00 },
  { id: 'c-002', name: 'Rivera Plumbing Services',  phone: '0918-445-7822', address: 'Biñan, Laguna',
    isCreditCustomer: true, creditLimit: 20000, currentBalance: 0.00 },
  { id: 'c-003', name: 'Aling Marites Sari-Sari',   phone: '0922-115-3344', address: 'Brgy. Poblacion',
    isCreditCustomer: true, creditLimit: 5000, currentBalance: 1280.50 },
  { id: 'c-004', name: 'Engr. Cruz (Residential)',  phone: '0915-770-2298', address: 'Calamba, Laguna',
    isCreditCustomer: true, creditLimit: 50000, currentBalance: 22450.00 },
  { id: 'c-005', name: 'Lopez Hardware (Wholesale)', phone: '0908-661-9001', address: 'Sta. Rosa, Laguna',
    isCreditCustomer: true, creditLimit: 100000, currentBalance: 0.00 },
];

const RECENT_SALES = [
  { id: 'TX-1042', time: '14:32', method: 'cash',   amount: 1245.00 },
  { id: 'TX-1041', time: '14:18', method: 'credit', amount: 3890.00, customer: 'Engr. Cruz' },
  { id: 'TX-1040', time: '14:02', method: 'cash',   amount: 245.50 },
  { id: 'TX-1039', time: '13:47', method: 'cash',   amount: 89.00 },
  { id: 'TX-1038', time: '13:21', method: 'cash',   amount: 1820.00 },
  { id: 'TX-1037', time: '13:08', method: 'credit', amount: 6450.00, customer: 'Mang Ricardo' },
  { id: 'TX-1036', time: '12:55', method: 'cash',   amount: 320.00 },
];

/* ==========================================================
   PRODUCT GROUPS
   A "group" is a parent tile in the Sell grid that opens a
   sub-grid of variants (e.g. tap "Common Wire Nails" → see
   2", 3", 4"). Persisted under hwpos.groups.v1
   ========================================================== */
const SEED_GROUPS = [
  { id: 'grp_pvc_elbow', name: 'PVC Elbows',         folder: 'plumbing'   },
  { id: 'grp_pvc_pipe',  name: 'PVC Pipes & Tees',   folder: 'plumbing'   },
  { id: 'grp_thhn',      name: 'THHN Wire',          folder: 'electrical' },
  { id: 'grp_nails',     name: 'Common Wire Nails',  folder: 'fasteners'  },
];

// Attach groupIds to existing seed products so groups have members.
const _GROUP_MEMBERSHIP = {
  // PVC Elbows
  p001: 'grp_pvc_elbow', p002: 'grp_pvc_elbow',
  // PVC Pipes & Tees (mixed sizes)
  p003: 'grp_pvc_pipe',  p004: 'grp_pvc_pipe',
  // THHN Wire
  e001: 'grp_thhn',      e002: 'grp_thhn',
  // Common Wire Nails
  f001: 'grp_nails',     f002: 'grp_nails',
};
PRODUCTS.forEach(p => { if (_GROUP_MEMBERSHIP[p.id]) p.groupId = _GROUP_MEMBERSHIP[p.id]; });
