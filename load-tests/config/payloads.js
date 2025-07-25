function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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

export const payloads = {
  // Payload estático para testes consistentes
  validPostData: {
    id: '876bd2da-ba5e-4a2b-999d-26863734df00',
    name: 'John Doe',
    email: 'test@k6.com.br',
    document: '88079892393',
    zip_code: '12345678',
    address: '123 Main St',
    address_number: '123',
    complement: 'Apt 4B',
    neighborhood: 'Downtown',
    city: 'New York',
    state: 'NY',
    phone_number: '1234567890'
  },

  // Função para gerar payload dinâmico
  generateDynamicPostData: function() {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    return {
      id: generateUUID(),
      name: firstName + ' ' + lastName,
      email: firstName.toLowerCase() + '.' + lastName.toLowerCase() + '@k6test.com',
      document: generateRandomNumber(11),
      zip_code: generateRandomNumber(8),
      address: 'Rua ' + firstName,
      address_number: generateRandomNumber(3),
      complement: 'Apt ' + generateRandomNumber(2),
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      phone_number: generateRandomNumber(10),
    };
  }
}; 