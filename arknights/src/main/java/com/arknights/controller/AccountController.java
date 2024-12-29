package com.arknights.controller;

import java.util.HashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.arknights.pojo.Result;
import com.arknights.pojo.User;
import com.arknights.service.AccountService;
import com.arknights.utils.JwtUtils;

import io.jsonwebtoken.Claims;
import lombok.extern.slf4j.Slf4j;

@CrossOrigin
@Slf4j
@RestController
@RequestMapping("/account")
public class AccountController {

  @Autowired
  private AccountService accountService;

  @PostMapping("/login")
  public Result login(@RequestBody User user) {
    User usr = accountService.login(user);
    if (usr != null){
      Map<String, Object> claims = new HashMap<>();

      claims.put("id", usr.getId());
      claims.put("username", usr.getUsername());
      claims.put("password", usr.getPassword());
      String jwt = JwtUtils.generateJwt(claims);
      return Result.success(jwt);
    }
    return Result.error("用户名或密码错误");
  }

  @PostMapping("/register")
  public Result register(@RequestBody User user) {
    if (accountService.register(user)) {
      return Result.success("注册成功");
    }
    return Result.error("用户已经注册，请登录");
  }
  
  @GetMapping("/identifyJwt")
  public Result parseJwt(@RequestParam String jwt){
    log.info(jwt);
    Claims claims = JwtUtils.parseJwt(jwt);
    if (claims == null){
      log.info("登录失败");
      return Result.error();
    }
    log.info("登录成功");
    return Result.success(claims);
  }
}
