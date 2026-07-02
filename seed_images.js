require('dotenv').config();
const mongoose = require('mongoose');

// Bản đồ sửa toạ độ đúng theo địa chỉ thực tế
// lat, lng lấy từ Google Maps tra thủ công
const coordinateFixes = {
  // --- Đà Nẵng - Ngũ Hành Sơn / FPT ---
  'Phở Thìn':                    { lat: 15.9838, lng: 108.2562 },  // khu Ngũ Hành Sơn
  'Nhà hàng ăn chay':           { lat: 15.9715, lng: 108.2530 },  // Khu đô thị FPT
  'Bún Đậu Ông Chú':            { lat: 15.9855, lng: 108.2571 },
  'Bún chả cá':                 { lat: 15.9821, lng: 108.2549 },
  'Nhà Hàng Buffet Sen Vàng':   { lat: 16.0688, lng: 108.2069 },  // Hải Châu

  // --- Đà Nẵng - Trung tâm ---
  'Phở Bò 34':                  { lat: 16.0610, lng: 108.2201 },
  'Bún Chả Hà Nội':             { lat: 16.0724, lng: 108.2180 },
  'Mì Quảng Bà Mười':           { lat: 16.0582, lng: 108.2135 },
  'Hải Sản Bé Mặn':             { lat: 16.0652, lng: 108.2110 },
  'Cơm Gà Hainan Đà Nẵng':     { lat: 16.0693, lng: 108.2064 },
  'Bánh Xèo Phan Chu Trinh':    { lat: 16.0562, lng: 108.2098 },
  'Sushi Yoshi':                 { lat: 16.0735, lng: 108.2173 },
  'KFC Nguyễn Văn Linh':        { lat: 16.0521, lng: 108.2282 },
  'Lotteria Đà Nẵng':           { lat: 16.0672, lng: 108.2145 },
  'Trà Sữa Gong Cha':           { lat: 16.0641, lng: 108.2100 },
  'Cà Phê Trung Nguyên':        { lat: 16.0700, lng: 108.2090 },
  'Bò Tơ Ngon Xanh':            { lat: 16.0664, lng: 108.2120 },
  'Lẩu Dê Đất Mẹ':              { lat: 16.0542, lng: 108.2162 },
  'Cơm Niêu Hong Kong':         { lat: 16.0712, lng: 108.2130 },
  'Korean BBQ Daegu':            { lat: 16.0655, lng: 108.2115 },
  'Bún Bò Bà Hương Đà Nẵng':   { lat: 16.0610, lng: 108.2201 },
  'Mì Quảng Bà Dậu Đà Nẵng':   { lat: 16.0724, lng: 108.2180 },
  'Sushi Ken Đà Nẵng':          { lat: 16.0735, lng: 108.2173 },

  // --- Nhà Hàng 123 - TP.HCM Quận 1 (sửa toạ độ vì địa chỉ là HCM) ---
  'Nhà Hàng 123':               { lat: 10.7721, lng: 106.6983 },

  // --- Sen Vàng - Hà Nội ---
  'Sen Vàng - Vietnamese Premium Dining': { lat: 21.0278, lng: 105.8512 },

  // --- Hội An ---
  'Cơm Gà Bà Năm Hội An':       { lat: 15.8801, lng: 108.3350 },
  'Bánh Mì Phượng Hội An':      { lat: 15.8773, lng: 108.3339 },
  'Mì Cao Lỗ Hội An':           { lat: 15.8832, lng: 108.3307 },
  'Bún Bò Huế Bà Hoa':          { lat: 15.8849, lng: 108.3325 },
  'Cao Lầu Bà Buộc':            { lat: 15.8792, lng: 108.3335 },
  'Bánh Vạc Bà Hường':          { lat: 15.8812, lng: 108.3313 },
  'Nước Mắm Hội An':            { lat: 15.8761, lng: 108.3401 },
  'Café Sài Gòn Hội An':        { lat: 15.8843, lng: 108.3350 },
  'Bún Thịt Nướng Bà Sương':    { lat: 15.8771, lng: 108.3361 },
  'Japanese BBQ Hội An':        { lat: 15.8821, lng: 108.3292 },
  'Korean Food Hội An':         { lat: 15.8845, lng: 108.3372 },
  'Pizza Hội An':               { lat: 15.8751, lng: 108.3381 },
  'Cơm Tấm Kiểu Sài Gòn':      { lat: 15.8801, lng: 108.3302 },
  'Trà Đá Hội An':              { lat: 15.8821, lng: 108.3322 },
  'Bít Tết Đà Nẵng Hội An':    { lat: 15.8692, lng: 108.3452 },

  // --- Duy Xuyên / Quảng Nam ---
  'Hải Sản Tươi Sống Duy Xuyên': { lat: 15.9021, lng: 108.3282 },
  'Phở Thanh Hà Duy Xuyên':    { lat: 15.9081, lng: 108.3252 },
  'Lẩu Cá Lóc Đặng Thị Nhu':  { lat: 15.8951, lng: 108.3201 },

  // --- Tam Kỳ ---
  'Bún Gạo Tam Kỳ':             { lat: 15.5733, lng: 108.4742 },
  'Cơm Việt Tam Kỳ':            { lat: 15.5701, lng: 108.4761 },

  // --- Quảng Ngãi ---
  'Bánh Xèo Quảng Ngãi':        { lat: 15.1202, lng: 108.7921 },
  'Bún Mắm Quảng Ngãi':         { lat: 15.1151, lng: 108.7951 },

  // --- Huế ---
  'Bún Bò Hue VIP':             { lat: 16.4674, lng: 107.5901 },
  'Cơm Hến Huế':                { lat: 16.4621, lng: 107.5851 },

  // --- Ninh Bình ---
  'Com Tam Tam Điệp':           { lat: 20.1051, lng: 105.9121 },

  // --- Hà Nội ---
  'Phở Thìn Hà Nội':            { lat: 21.0281, lng: 105.8512 },
  'Bún Chả Hà Nội 94':          { lat: 21.0291, lng: 105.8489 },

  // --- TP. Hồ Chí Minh ---
  'Cơm Tấm Kiều Giang':         { lat: 10.7721, lng: 106.6981 },
  'Phở Hòa Sài Gòn':            { lat: 10.7782, lng: 106.7001 },
};

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const Restaurant = mongoose.model('Restaurant', new mongoose.Schema({}, { strict: false }));
  let updated = 0;

  for (const [name, coords] of Object.entries(coordinateFixes)) {
    const result = await Restaurant.updateOne(
      { name },
      {
        $set: {
          'coordinates.latitude': coords.lat,
          'coordinates.longitude': coords.lng,
          'location.coordinates': [coords.lng, coords.lat], // GeoJSON [lng, lat]
        }
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`✅ Fixed: "${name}" -> (${coords.lat}, ${coords.lng})`);
      updated++;
    } else {
      console.log(`⚠️  Not found: "${name}"`);
    }
  }

  console.log(`\nDone! Updated ${updated} restaurants.`);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
