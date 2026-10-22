/** Ký tự đặc biệt của LIKE trong chuỗi người dùng nhập được tìm đúng nghĩa đen (ESCAPE mặc định là \). */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");
