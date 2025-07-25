function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomNumber(length) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += Math.floor(Math.random() * 10).toString();
  }
  return result;
}

const firstNames = ['João', 'Maria', 'Pedro', 'Ana', 'Carlos', 'Fernanda', 'Ricardo', 'Juliana'];
const lastNames = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Costa', 'Pereira', 'Rodrigues'];
const cities = ['São Paulo', 'Rio de Janeiro', 'Belo Horizonte', 'Salvador', 'Brasília', 'Fortaleza'];
const states = ['SP', 'RJ', 'MG', 'BA', 'DF', 'CE', 'PR', 'RS'];

export function createUserPayload() {
  const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
  const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
  const city = cities[Math.floor(Math.random() * cities.length)];
  const state = states[Math.floor(Math.random() * states.length)];
  
  return {
    id: generateUUID(),
    name: firstName + ' ' + lastName,
    email: firstName.toLowerCase() + '.' + lastName.toLowerCase() + '@k6.com.br',
    document: generateRandomNumber(11),
    zip_code: generateRandomNumber(8),
    address: 'Rua ' + generateRandomString(10),
    address_number: generateRandomNumber(3),
    complement: 'Apt ' + generateRandomNumber(2),
    neighborhood: generateRandomString(8),
    city: city,
    state: state,
    phone_number: generateRandomNumber(10),
  };
} 