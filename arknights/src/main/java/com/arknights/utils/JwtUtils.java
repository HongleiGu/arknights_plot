package com.arknights.utils;

import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;
import lombok.extern.slf4j.Slf4j;

@Slf4j
public class JwtUtils {
  private static String signKey = "arknights";
  private static Long expire = 86400000L; // 24小时

  public static String generateJwt(Map<String, Object> claims){
    String jwt = Jwts.builder()
      .signWith(SignatureAlgorithm.HS256,signKey) // 设置签名算法
      .setClaims(claims) // 设置数据
      .setExpiration(new Date(System.currentTimeMillis() + expire)) // 设置有效时间
      .compact(); // 转为字符串
    return jwt;
  }

  public static Claims parseJwt(String jwt){
    try{
      Claims claims = Jwts.parser()
        .setSigningKey(signKey) // 设置秘钥
        .parseClaimsJws(jwt)
        .getBody();
      return claims;
    }
    catch (Exception e) {
      e.printStackTrace();
      return null;
    }
  }
}
