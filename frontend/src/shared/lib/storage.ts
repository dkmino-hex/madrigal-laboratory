export const readPreference = (key: string) => {
  try {
    return localStorage.getItem('madrigal:v1:' + key);
  } catch {
    return null;
  }
};
export const savePreference = (key: string, value: string) => {
  try {
    localStorage.setItem('madrigal:v1:' + key, value);
    return true;
  } catch {
    return false;
  }
};
export const forgetPreference = (key: string) => {
  try {
    localStorage.removeItem('madrigal:v1:' + key);
  } catch {
    /* Необязательное предпочтение */
  }
};
