// Initial data loaded on first run only. Everything here is editable from the app afterwards.

export const OUTLETS = [
  ['Kazhyakoottam', 'Thiruvananthapuram'],
  ['Alapuzhya', 'Alappuzha'],
  ['Iratupetta', 'Kottayam'],
  ['Kanjirapally', 'Kottayam'],
  ['Kaloor', 'Ernakulam'],
  ['Thoppumpadi', 'Ernakulam'],
  ['Irumbanam', 'Ernakulam'],
  ['Mamangalam', 'Ernakulam'],
  ['Thrissur West Fort', 'Thrissur'],
  ['Guruvayoor', 'Thrissur'],
  ['Ashtamichira', 'Thrissur'],
  ['Irinjalakuda', 'Thrissur'],
  ['Changaramkulam', 'Malappuram'],
  ['Melattur', 'Malappuram'],
  ['Nilambur', 'Malappuram'],
  ['Valancheri', 'Malappuram'],
  ['Kondotty', 'Malappuram'],
  ['Mannarkad', 'Palakkad'],
  ['Palakkad', 'Palakkad'],
  ['Feroke', 'Kozhikode'],
  ['Balussery', 'Kozhikode'],
  ['Manathavadi', 'Wayanad'],
  ['Kuttyadi', 'Kozhikode'],
  ['Avinashi', 'Tiruppur'],
  ['Thirupur', 'Tiruppur'],
];

// [product, price] — one entry per product; flavours are not tracked.
export const MENU = [
  ['Qashtuta', 320],
  ["Lou'a", 380],
  ['Salankatia', 380],
  ['Ambalyh', 320],
  ['Koushri', 380],
  ['Heba Cake', 380],
  ['Layali', 370],
  ['Choco Crepe', 279],
  ['Sankorita', 590],
  ['Signature Chocoara', 490],
  ['Hazelnut Bar', 550],
  ['Cheese Bomb', 320],
  ['Kabsa', 380],
  ['Mango Kunafa', 280],
  ['Kashkha', 650],
  ['Fazea Chocola Cake', 420],
  ['De Paris', 380],
];

// First-run login. The password is never stored in the code: set ADMIN_PASSWORD before the
// first start, or a random one is generated and printed once in the server log.
export const DEFAULT_ADMIN = { name: 'Qasr Laban Manager', username: 'admin' };
