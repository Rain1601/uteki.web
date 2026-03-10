import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// 创建axios实例 — 使用相对路径，本地走 vite proxy，生产环境同源
const apiClient: AxiosInstance = axios.create({
  baseURL: '',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error) => {
    if (error.response) {
      // 处理各种HTTP错误
      const { status, data } = error.response;
      console.error(`API Error ${status}:`, data);

      if (status === 401) {
        // 未授权，清除token并跳转登录
        // localStorage.removeItem('auth_token');
        // window.location.href = '/login';
      }
    } else if (error.request) {
      console.error('Network Error:', error.request);
    } else {
      console.error('Error:', error.message);
    }
    return Promise.reject(error);
  }
);

export default apiClient;

// 导出便捷方法
export const get = <T = any>(url: string, config?: AxiosRequestConfig) =>
  apiClient.get<T>(url, config).then((res) => res.data);

export const post = <T = any>(url: string, data?: any, config?: AxiosRequestConfig) =>
  apiClient.post<T>(url, data, config).then((res) => res.data);

export const put = <T = any>(url: string, data?: any, config?: AxiosRequestConfig) =>
  apiClient.put<T>(url, data, config).then((res) => res.data);

export const patch = <T = any>(url: string, data?: any, config?: AxiosRequestConfig) =>
  apiClient.patch<T>(url, data, config).then((res) => res.data);

export const del = <T = any>(url: string, config?: AxiosRequestConfig) =>
  apiClient.delete<T>(url, config).then((res) => res.data);
