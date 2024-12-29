"use client";

import { Button, Col, Form, Input, Row, Typography } from "antd"
// import { register } from "module";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
// import { NextResponse } from "next/server";
import { useState } from "react"
import useLoginStore from "../store/login";
import { User } from "next-auth";
import { findUsername, register } from "@/utils/api";
import { hash } from "bcryptjs";
import "./page.scss"

export default function Page() {
  const [username,setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setComfirmPassword] = useState<string>('')
  const [activateMode, setActivateMode] = useState<string>('login')
  const [message, setMessage] = useState<string>("");
  // const loginElem = useRef(null);
  // const registerElem = useRef(null);
  // const comfirmPasswordElem = useRef(null);
  // const messageElem = useRef(null);
  const router = useRouter()
  const store = useLoginStore()
  const loginfunc = async() => {
    // Use NextAuth's signIn method for authentication
      const result = await signIn('credentials', {
        redirect: false,
        username,
        password,
      });
    
      if (result == undefined) {
        setMessage("invalid result")
        return
        // return NextResponse.json({ code: 0, message: "invalid result"}, {status: 400})
      }
    
      if (result.error) {
        setMessage(result.error)
        return
        // return NextResponse.json({ code: 0, message: result.error }, { status: 401 });
      }

      store.setUser({name: username} as User)
      router.push("/home")
  }
  const registerfunc = async() => {
    if (password != confirmPassword) {
      setMessage("两次输入的密码不一致")
      return
    }
    const existingUser = await findUsername(username)
    const rowCount = existingUser.length
    if (rowCount > 0) {
      setMessage("Username already taken")
      return
      // return NextResponse.json({ code: 0, message: 'Username already taken' }, { status: 400 });
    }

    // Hash the password
    const salt = 10
    const hashedPassword = await hash(password, salt);

    // Insert the new user into the database
    // await sql`INSERT INTO users (username, password) VALUES (${username}, ${hashedPassword})`;
    await register({username: username, password: hashedPassword})
    setMessage("注册成功")
  }
  return (
    <div className="LoginPage page">
      <div className="LoginPage background"></div>
      <div className="LoginPage router-view">
        <div className="LoginPage container">
          <Form className="LoginPage form-container">
            <Form.Item>
              <Col span={16} offset={4}>
                <Row>
                  <Col span={10}>
                    <Button
                      className={`LoginPage mode ${activateMode === 'login' ? 'active-mode' : ''}`}
                      onClick={() => {setActivateMode('login'); setMessage("")}}
                    >
                      登录
                    </Button>
                  </Col>
                  <Col span={10}>
                    <Button
                      className={`LoginPage mode ${activateMode === 'register' ? 'active-mode' : ''}`}
                      onClick={() => {setActivateMode('register'); setMessage("")}}
                    >
                      注册
                    </Button>
                  </Col>
                </Row>
              </Col>
            </Form.Item>
            <Form.Item>
              <Col span={16} offset={4}>
                <p>用户名</p>
                <Input value={username} onChange={e => setUsername(e.target.value)} />
              </Col>
            </Form.Item>
            <Form.Item>
              <Col span={16} offset={4}>
                <p>密码</p>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} />
              </Col>
            </Form.Item>
            { activateMode === 'register' &&
              <Form.Item>
                <Col span={16} offset={4}>
                  <p>确认密码</p>
                  <Input 
                    type="password"
                    value={confirmPassword} 
                    onChange={e => setComfirmPassword(e.target.value)}
                  />
                </Col>
              </Form.Item>
            }
            {message && (
              <Form.Item>
                <Col span={16} offset={4}>
                  <Typography.Text type="danger">{message}</Typography.Text>
                </Col>
              </Form.Item>
            )}
            <Form.Item>
              <Col span={16} offset={4}>
                <Button
                  className="LoginPage submit-button"
                  onClick={activateMode === "login" ? loginfunc : registerfunc}
                >
                  {activateMode === "login" ? "登录" : "注册"}
                </Button>
              </Col>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  )
}